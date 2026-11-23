// Fork: My layers' list (outliner/index.ts): drag and drop: items onto a layer, layers above or below another, into a folder or out of one.
import { t } from '../../../../core/i18n.ts'
import { el } from 'redom'
import type { UserLayer } from '../../model/model.ts'
import { layerOrder, placed } from './order.ts'
import { moveToFolder } from './menus.ts'
import type { OutlinerContext } from './types.ts'

/** Put a layer just above or below another (and in its folder). */
export function placeLayer(c: OutlinerContext, id: string, target: UserLayer, before: boolean) {
  const layer = c.store.layers.get(id)
  if (!layer || id === target.id) return
  const order = layerOrder([...c.store.layers.values()], c.personal)
  c.personal.setFolder(id, c.folderOf(target))
  c.personal.setOrder(placed(order, id, target.id, before))
  c.actions.update()
  c.actions.reordered()
}

/** Make a row accept items (moved into the layer) or layers (put in the folder). */
export function dropTarget(row: HTMLElement, onItem?: (id: string) => void, onLayer?: (id: string) => void) {
  row.ondragover = (e) => {
    const types = e.dataTransfer?.types ?? []
    if (
      (onItem && types.includes('application/x-oim-item')) ||
      (onLayer && types.includes('application/x-oim-layer'))
    ) {
      e.preventDefault()
      row.classList.add('oim-ul-drop')
    }
  }
  row.ondragleave = () => row.classList.remove('oim-ul-drop')
  row.ondrop = (e) => {
    row.classList.remove('oim-ul-drop')
    const item = e.dataTransfer?.getData('application/x-oim-item')
    const layer = e.dataTransfer?.getData('application/x-oim-layer')
    if (item && onItem) onItem(item)
    else if (layer && onLayer) onLayer(layer)
    e.preventDefault()
  }
}

/** A layer row: items dropped on it move into it; a layer dropped on it goes just
 * above or below it (which half of the row), in its folder. */
export function layerDropTarget(c: OutlinerContext, row: HTMLElement, layer: UserLayer) {
  const store = c.store
  const before = (e: DragEvent) => e.offsetY < row.clientHeight / 2
  const clear = () => row.classList.remove('oim-ul-drop', 'oim-ul-drop-before', 'oim-ul-drop-after')
  row.ondragover = (e) => {
    const types = e.dataTransfer?.types ?? []
    if (types.includes('application/x-oim-item')) {
      e.preventDefault()
      row.classList.add('oim-ul-drop')
    } else if (types.includes('application/x-oim-layer')) {
      e.preventDefault()
      clear()
      row.classList.add(before(e) ? 'oim-ul-drop-before' : 'oim-ul-drop-after')
    }
  }
  row.ondragleave = clear
  row.ondrop = (e) => {
    clear()
    e.preventDefault()
    const item = e.dataTransfer?.getData('application/x-oim-item')
    const dropped = e.dataTransfer?.getData('application/x-oim-layer')
    if (item) {
      const from = store.layerOf(item)
      if (
        from &&
        from.id !== layer.id &&
        store.view.canEditItem(from, from.features.get(item)) &&
        store.view.canEdit(layer)
      )
        store.moveFeature(item, layer.id)
    } else if (dropped) placeLayer(c, dropped, layer, before(e))
  }
}

/** Where a dragged layer is dropped to take it out of its folder (only with folders). */
export function dropOutRow(c: OutlinerContext): HTMLElement | null {
  const store = c.store
  // Drop a layer on this (it shows while one is dragged): out of its folder.
  const loose = el(
    'li.oim-ul-drop-out',
    t('userlayers.drop-out', 'Drop a layer here to take it out of its folder')
  )
  dropTarget(loose, undefined, (id) => {
    const layer = store.layers.get(id)
    if (layer) moveToFolder(c, layer, null)
  })
  return [...store.layers.values()].some((l) => c.folderOf(l)) ? loose : null
}
