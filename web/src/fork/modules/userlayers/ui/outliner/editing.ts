// Fork: My layers' list (outliner/index.ts): a layer's or folder's name typed in place; a new folder.
import { t } from '../../../../core/i18n.ts'
import { el } from 'redom'
import type { Editing } from './types.ts'
import { folderNames } from './menus.ts'
import type { OutlinerContext } from './types.ts'

/** A name nobody uses yet: "New folder", "New folder 2"... */
export function freeName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base
  let n = 2
  while (taken.includes(`${base} ${n}`)) n++
  return `${base} ${n}`
}

/** Start typing a layer's or folder's name in place. */
export function startEditing(c: OutlinerContext, kind: Editing['kind'], id: string) {
  const value = kind === 'layer' ? (c.store.layers.get(id)?.name ?? '') : id
  c.editing = { kind, id, value, fresh: true }
  // A folder being renamed is open.
  if (kind === 'folder') c.personal.toggle('folded', id, false)
  c.actions.update()
}

/** "+ New folder": shown at once, empty, its name ready to type. */
export function newFolder(c: OutlinerContext) {
  const name = freeName(t('userlayers.new-folder-name', 'New folder'), folderNames(c))
  c.personal.toggle('empty', name, true)
  startEditing(c, 'folder', name)
}

export function finishEditing(c: OutlinerContext, keep: boolean) {
  const editing = c.editing
  if (!editing) return
  c.editing = null
  const value = editing.value.trim()
  if (keep && editing.kind === 'layer') {
    const layer = c.store.layers.get(editing.id)
    if (layer && value && value !== layer.name) c.store.updateLayer(layer.id, { name: value })
  } else if (keep && editing.kind === 'folder' && value !== editing.id) {
    // Renaming a folder: its layers go with it (empty: out of any folder).
    const layers = [...c.store.layers.values()].filter((l) => c.folderOf(l) === editing.id)
    c.personal.toggle('empty', editing.id, false)
    if (!layers.length && value) c.personal.toggle('empty', value, true)
    for (const l of layers) c.personal.setFolder(l.id, value || null)
  }
  c.actions.update()
}

/** The text field a name is typed in, in place of the name. */
export function nameInput(c: OutlinerContext): HTMLInputElement {
  const editing = c.editing!
  const input = el('input.oim-ul-rename', {
    type: 'text',
    value: editing.value,
    'aria-label': t('userlayers.rename', 'Rename')
  }) as HTMLInputElement
  input.oninput = () => (editing.value = input.value)
  input.onkeydown = (e) => {
    e.stopPropagation()
    if (e.key === 'Enter') finishEditing(c, true)
    else if (e.key === 'Escape') finishEditing(c, false)
  }
  input.onblur = () => {
    // Drawn again meanwhile (another change): the new field takes over.
    if (c.editing === editing && input.isConnected) finishEditing(c, true)
  }
  for (const event of ['click', 'dblclick', 'mousedown'] as const)
    input.addEventListener(event, (e) => e.stopPropagation())
  return input
}
