// Fork: what the left details panel shows for My layers: the selected item's card
// (editor.ts), one card for several selected items, nothing while a past version
// is shown. A locked layer's card can be looked at, not changed.
import { el } from 'redom'
import { t } from '../../../core/i18n.ts'
import { leftColumn } from '../../../ui/left-column.ts'
import { UserFeature, UserLayer } from '../model/model.ts'
import { buildBulkCard, buildEditor } from './editor/index.ts'
import { geometryCentre, translateGeometry } from '../map/geometry.ts'
import type { Workspace } from './workspace.ts'

export class Inspector {
  // Which item (and version) the card shows, so it's only rebuilt when it changes.
  private editorKey: string | null = null
  private ws: Workspace

  constructor(ws: Workspace) {
    this.ws = ws
  }

  async sync() {
    const { store, tools } = this.ws
    const view = store.view
    const panel = leftColumn.details
    // Several items: one card for all of them.
    const ids = view.live ? tools.selection() : []
    if (ids.length > 1) {
      const items = ids
        .map((i) => {
          const layer = store.layerOf(i)
          const feature = layer?.features.get(i)
          return layer && feature ? { layer, feature } : null
        })
        .filter((x): x is { layer: UserLayer; feature: UserFeature } => x !== null)
      const key = `bulk:${JSON.stringify(items.map((i) => [i.layer.id, i.feature]))}`
      if (key === this.editorKey) return
      this.editorKey = key
      const card = buildBulkCard(items, [...store.layers.values()], {
        updateEach: (change) =>
          store.updateFeatures(
            items
              .filter((i) => view.canEditItem(i.layer, i.feature))
              .map((i) => ({
                layerId: i.layer.id,
                feature: { ...i.feature, properties: change(i.feature.properties) }
              }))
              .filter((c): c is { layerId: string; feature: UserFeature } => c.feature.properties !== null)
          ),
        moveTo: (layerId) =>
          store.moveFeatures(
            items
              .filter((i) => view.canEditItem(i.layer, i.feature) && i.layer.id !== layerId)
              .map((i) => i.feature.id),
            layerId
          ),
        remove: () => {
          if (
            window.confirm(t('userlayers.delete-n', 'Delete these {{count}} items?', { count: items.length }))
          )
            tools.deleteSelected()
        },
        clear: () => tools.select(null),
        canEdit: (l) => view.canEdit(l)
      })
      panel.show(card, () => {
        if (this.editorKey === key) {
          this.editorKey = null
          tools.select(null)
        }
      })
      return
    }
    const id = view.live ? tools.selected : null
    const layer = id ? store.layerOf(id) : undefined
    const feature = id ? layer?.features.get(id) : undefined
    if (!id || !layer || !feature) {
      if (this.editorKey) {
        this.editorKey = null
        panel.close()
      }
      return
    }
    const key = `${id}:${layer.id}:${JSON.stringify(feature)}`
    if (key === this.editorKey) return
    this.editorKey = key
    // Keep the focus where it was (each change rebuilds the editor).
    const focused = (document.activeElement as HTMLElement | null)?.getAttribute?.('data-field')
    const editor = await buildEditor(feature, layer, [...store.layers.values()], {
      update: (properties) => store.updateFeature(layer.id, { ...feature, properties }),
      setGeometry: (geometry) => store.updateFeature(layer.id, { ...feature, geometry }),
      moveTo: (layerId) => store.moveFeature(id, layerId),
      duplicate: () => this.duplicate(layer.id, feature),
      remove: () => tools.deleteSelected(),
      done: () => tools.select(null),
      canEdit: (l) => view.canEdit(l)
    })
    if (this.editorKey !== key) return // something newer
    const itemLocked = Boolean(feature.properties.locked)
    if (!view.canEditItem(layer, feature)) {
      // A locked layer's items, or a locked item, can be looked at, not changed.
      editor
        .querySelectorAll<HTMLButtonElement | HTMLInputElement>('input, select, textarea, button')
        .forEach((c) => {
          if (!c.classList.contains('primary')) c.disabled = true
        })
      editor.insertBefore(
        el(
          'p.oim-ul-locked-note',
          view.canEdit(layer) && itemLocked
            ? t('userlayers.item-locked-note', '🔒 Locked: unlock it to change, move or delete it.')
            : t('userlayers.locked-note', '🔒 In a locked layer: unlock it in the list to change this.')
        ),
        editor.children[1] ?? null
      )
    }
    if (view.canEdit(layer)) {
      // Lock or unlock this one item (any item, e.g. a measurement to keep as it is).
      const lock = el(
        'button.oim-ul-button.oim-ul-item-lock',
        itemLocked ? t('userlayers.unlock-item', '🔓 Unlock') : t('userlayers.lock-item', '🔒 Lock'),
        {
          type: 'button',
          title: itemLocked
            ? t('userlayers.unlock-item-title', 'Allow changes to this item again')
            : t('userlayers.lock-item-title', 'Keep this item from being changed, moved or deleted')
        }
      ) as HTMLButtonElement
      lock.onclick = () =>
        store.updateFeature(layer.id, {
          ...feature,
          properties: { ...feature.properties, locked: itemLocked ? undefined : true }
        })
      editor.insertBefore(lock, editor.children[1] ?? null)
    }
    panel.show(editor, () => {
      // Closed (×, Esc) or replaced by another feature's details: deselect.
      if (this.editorKey === key) {
        this.editorKey = null
        tools.select(null)
      }
    })
    if (focused) editor.querySelector<HTMLElement>(`[data-field="${CSS.escape(focused)}"]`)?.focus()
  }

  /** A copy of an item, a little to the side, selected. */
  private duplicate(layerId: string, feature: UserFeature) {
    const { map, store, tools } = this.ws
    // 24 px to the right and down, whatever the zoom.
    const centre = geometryCentre(feature.geometry)
    const p = map.project(centre)
    const moved = map.unproject([p.x + 24, p.y + 24])
    const geometry = translateGeometry(feature.geometry, moved.lng - centre[0], moved.lat - centre[1])
    const id = store.addFeature(layerId, geometry, structuredClone(feature.properties))
    tools.select(id)
  }
}
