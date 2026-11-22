// Fork: working on My layers' items directly on the map (docs/plans/my-layers-v3.md):
// - hover: a tooltip with the item's name, type and status;
// - right-click: the item's menu (item-menu.ts, the list's too);
// - double-click: rename (opens the card with the name ready to type);
// - Ctrl+C / Ctrl+V: copy the selected item, paste it where the pointer is.
import { el } from 'redom'
import { Map, MapGeoJSONFeature, MapMouseEvent, PointLike } from 'maplibre-gl'
import { Store } from '../state/store.ts'
import { Tools } from './tools.ts'
import { Renderer } from './render.ts'
import { geometryCentre, translateGeometry } from './geometry.ts'
import { UserFeature } from '../model/model.ts'
import { featureLabelParts } from '../model/labels.ts'
import { openContextMenu, type MenuItem } from '../../../ui/context-menu.ts'
import { itemMenu } from './item-menu.ts'

export class Interactions {
  private map: Map
  private store: Store
  private tools: Tools
  private renderer: Renderer
  private isOpen: () => boolean
  private tooltip = el('.oim-ul-tooltip')
  private clipboard: UserFeature | null = null
  private pointer: [number, number] | null = null

  constructor(map: Map, store: Store, tools: Tools, renderer: Renderer, isOpen: () => boolean) {
    this.map = map
    this.store = store
    this.tools = tools
    this.renderer = renderer
    this.isOpen = isOpen
    map.getContainer().append(this.tooltip)
    map.on('mousemove', (e) => this.hover(e))
    map.on('mouseout', () => this.tooltip.classList.remove('visible'))
    map.on('contextmenu', (e) => this.contextMenu(e))
    map.on('dblclick', (e) => this.rename(e))
    document.addEventListener('keydown', (e) => this.keydown(e))
  }

  /** The My layers item under a point, if any (and where it is stored). */
  private itemAt(point: PointLike): { feature: UserFeature; layerId: string } | null {
    const layers = this.renderer.featureLayerIds()
    if (!layers.length) return null
    const [x, y] = Array.isArray(point) ? point : [(point as { x: number }).x, (point as { y: number }).y]
    const hit: MapGeoJSONFeature | undefined = this.map.queryRenderedFeatures(
      [
        [x - 5, y - 5],
        [x + 5, y + 5]
      ],
      { layers }
    )[0]
    const id = hit?.properties.fid
    if (!id) return null
    const layer = this.store.layerOf(String(id))
    const feature = layer?.features.get(String(id))
    return layer && feature ? { feature, layerId: layer.id } : null
  }

  // --- Hover ----------------------------------------------------------------------

  private hover(e: MapMouseEvent) {
    this.pointer = [e.lngLat.lng, e.lngLat.lat]
    if (this.tools.tool.mode !== 'select' || e.originalEvent.buttons) {
      this.tooltip.classList.remove('visible')
      return
    }
    const item = this.itemAt(e.point)
    if (!item) {
      this.tooltip.classList.remove('visible')
      return
    }
    const { name, what, detail } = featureLabelParts(item.feature)
    this.tooltip.replaceChildren(
      el('strong', name || what),
      name ? el('span', what) : '',
      detail ? el('small', detail) : ''
    )
    this.tooltip.style.left = `${e.point.x + 14}px`
    this.tooltip.style.top = `${e.point.y + 14}px`
    this.tooltip.classList.add('visible')
  }

  // --- Right-click menu --------------------------------------------------------------

  /** An item's right-click menu (item-menu.ts), as the list shows it too. */
  itemMenu(feature: UserFeature, layerId: string): MenuItem[] {
    return itemMenu(
      {
        store: this.store,
        rename: (id) => this.focusName(id),
        duplicate: (f, l) => this.paste(f, l, 'beside'),
        copy: (f) => (this.clipboard = structuredClone(f))
      },
      feature,
      layerId
    )
  }

  /** On the map, the menu says which item it's for (the list's row already does). */
  private contextMenu(e: MapMouseEvent) {
    const item = this.itemAt(e.point)
    if (!item || !this.tools.enabled) return
    e.preventDefault()
    e.originalEvent.preventDefault()
    this.tooltip.classList.remove('visible')
    const { name, what } = featureLabelParts(item.feature)
    openContextMenu(e.originalEvent.clientX, e.originalEvent.clientY, [
      { heading: name || what },
      ...this.itemMenu(item.feature, item.layerId)
    ])
  }

  // --- Rename, copy and paste --------------------------------------------------------------

  /** Select an item and put the cursor in its name, on the card. */
  private focusName(id: string) {
    this.tools.select(id)
    // The card is drawn once the selection's change has gone round.
    let tries = 0
    const focus = () => {
      const input = document.querySelector<HTMLInputElement>('.oim-ul-editor input[data-field="title"]')
      if (input && !input.disabled) {
        input.focus()
        input.select()
      } else if (tries++ < 20) setTimeout(focus, 50)
    }
    focus()
  }

  private rename(e: MapMouseEvent) {
    if (this.tools.tool.mode !== 'select' || !this.tools.enabled) return
    const item = this.itemAt(e.point)
    if (!item) return
    e.preventDefault() // no zoom
    this.focusName(item.feature.id)
  }

  /** Paste a copy: at the pointer, or just beside the original. */
  private paste(feature: UserFeature, layerId: string | null, where: 'pointer' | 'beside') {
    const centre = geometryCentre(feature.geometry)
    let to: [number, number]
    if (where === 'pointer' && this.pointer) {
      to = this.pointer
    } else {
      // 24 px to the right and down, whatever the zoom.
      const p = this.map.project(centre)
      const moved = this.map.unproject([p.x + 24, p.y + 24])
      to = [moved.lng, moved.lat]
    }
    const [dLng, dLat] = [to[0] - centre[0], to[1] - centre[1]]
    // Into the given layer, else the "Into" one, else any that isn't locked.
    const open = (id: string | null) => (id && this.store.view.canEdit(this.store.layers.get(id)) ? id : null)
    const target =
      open(layerId) ??
      open(this.store.activeLayer) ??
      [...this.store.layers.values()].find((l) => this.store.view.canEdit(l))?.id
    if (!target) return
    const id = this.store.addFeature(
      target,
      translateGeometry(feature.geometry, dLng, dLat),
      structuredClone(feature.properties)
    )
    this.tools.select(id)
  }

  private keydown(e: KeyboardEvent) {
    if (!this.isOpen() || !this.tools.enabled) return
    if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return
    if (!(e.ctrlKey || e.metaKey)) return
    const key = e.key.toLowerCase()
    if (key === 'c' && this.tools.selected) {
      const layer = this.store.layerOf(this.tools.selected)
      const feature = layer?.features.get(this.tools.selected)
      if (feature) {
        this.clipboard = structuredClone(feature)
        e.preventDefault()
      }
    } else if (key === 'v' && this.clipboard) {
      e.preventDefault()
      this.paste(this.clipboard, this.store.activeLayer, 'pointer')
    }
  }
}
