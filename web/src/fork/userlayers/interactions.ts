// Fork: working on My layers' items directly on the map (docs/plans/my-layers-v3.md):
// - hover: a tooltip with the item's name, type and status;
// - right-click: a menu (identity, present / planned, duplicate, move to layer,
//   delete);
// - double-click: rename (opens the card with the name ready to type);
// - Ctrl+C / Ctrl+V: copy the selected item, paste it where the pointer is.
import { tt } from './i18n.ts'
import { el } from 'redom'
import { Map, MapGeoJSONFeature, MapMouseEvent, PointLike } from 'maplibre-gl'
import { Store } from './store.ts'
import { Tools } from './tools.ts'
import { Renderer, geometryCentre, translateGeometry } from './render.ts'
import { UserFeature } from './model.ts'
import { featureLabelParts } from './labels.ts'
import { IDENTITIES, status, withIdentity, withStatus } from './sidc.ts'

export class Interactions {
  private map: Map
  private store: Store
  private tools: Tools
  private renderer: Renderer
  private isOpen: () => boolean
  private tooltip = el('.oim-ul-tooltip')
  private menu = el('.oim-ul-context')
  private clipboard: UserFeature | null = null
  private pointer: [number, number] | null = null

  constructor(map: Map, store: Store, tools: Tools, renderer: Renderer, isOpen: () => boolean) {
    this.map = map
    this.store = store
    this.tools = tools
    this.renderer = renderer
    this.isOpen = isOpen
    map.getContainer().append(this.tooltip, this.menu)
    map.on('mousemove', (e) => this.hover(e))
    map.on('mouseout', () => this.tooltip.classList.remove('visible'))
    map.on('contextmenu', (e) => this.contextMenu(e))
    map.on('dblclick', (e) => this.rename(e))
    map.on('movestart', () => this.closeMenu())
    document.addEventListener('mousedown', (e) => {
      if (!this.menu.contains(e.target as Node)) this.closeMenu()
    })
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

  private closeMenu() {
    this.menu.classList.remove('visible')
  }

  private contextMenu(e: MapMouseEvent) {
    const item = this.itemAt(e.point)
    if (!item || !this.tools.enabled) return
    e.preventDefault()
    e.originalEvent.preventDefault()
    this.tooltip.classList.remove('visible')
    const { feature, layerId } = item
    this.tools.select(feature.id)
    const locked = Boolean(this.store.layers.get(layerId)?.style.locked)
    const entry = (label: string, onclick: () => void, disabled = false) => {
      const b = el('button', label, { type: 'button', disabled }) as HTMLButtonElement
      b.onclick = () => {
        this.closeMenu()
        onclick()
      }
      return b
    }
    const update = (changes: Partial<UserFeature['properties']>) =>
      this.store.updateFeature(layerId, { ...feature, properties: { ...feature.properties, ...changes } })
    const items: HTMLElement[] = []
    const { name, what } = featureLabelParts(feature)
    items.push(el('h4', name || what))
    const sidc = feature.properties.sidc
    if (sidc) {
      items.push(
        el(
          '.oim-ul-context-row',
          ...['F', 'H', 'N', 'U'].map((id) => {
            const b = entry(
              IDENTITIES.find(([c]) => c === id)?.[1] ?? id,
              () => update({ sidc: withIdentity(sidc, id) }),
              locked || sidc[1] === id
            )
            b.classList.add(`oim-ul-context-${id}`)
            return b
          })
        ),
        status(sidc) === 'A'
          ? entry(
              tt('userlayers.make-present', 'Mark as present'),
              () => update({ sidc: withStatus(sidc, 'P') }),
              locked
            )
          : entry(
              tt('userlayers.make-planned', 'Mark as planned'),
              () => update({ sidc: withStatus(sidc, 'A') }),
              locked
            )
      )
    }
    items.push(
      entry(tt('userlayers.rename', 'Rename'), () => this.focusName(feature.id), locked),
      entry(tt('userlayers.duplicate', 'Duplicate'), () => this.paste(feature, layerId, 'beside')),
      entry(tt('userlayers.copy-item', 'Copy (Ctrl+C)'), () => (this.clipboard = structuredClone(feature)))
    )
    const others = [...this.store.layers.values()].filter((l) => l.id !== layerId && !l.style.locked)
    if (others.length && !locked) {
      items.push(
        el(
          'details',
          el('summary', tt('userlayers.move-to', 'Move to layer')),
          ...others.map((l) => entry(l.name, () => this.store.moveFeature(feature.id, l.id)))
        )
      )
    }
    items.push(entry(tt('userlayers.delete', 'Delete'), () => this.tools.deleteSelected(), locked))
    this.menu.replaceChildren(...items)
    // Keep it inside the map.
    const box = this.map.getContainer().getBoundingClientRect()
    this.menu.style.left = `${Math.min(e.point.x, box.width - 200)}px`
    this.menu.style.top = `${Math.min(e.point.y, box.height - 260)}px`
    this.menu.classList.add('visible')
  }

  // --- Rename, copy and paste --------------------------------------------------------------

  /** Select an item and put the cursor in its name, on the card. */
  private focusName(id: string) {
    this.tools.select(id)
    // The card is drawn asynchronously (it renders the symbol).
    let tries = 0
    const focus = () => {
      const input = document.querySelector<HTMLInputElement>('.oim-ul-card-title')
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
    const open = (id: string | null) =>
      id && this.store.layers.get(id) && !this.store.layers.get(id)!.style.locked ? id : null
    const target =
      open(layerId) ??
      open(this.store.activeLayer) ??
      [...this.store.layers.values()].find((l) => !l.style.locked)?.id
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
    if (e.key === 'Escape') this.closeMenu()
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
