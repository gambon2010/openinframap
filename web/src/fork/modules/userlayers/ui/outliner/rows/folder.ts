// Fork: My layers' list (outliner/index.ts): a folder's row: its eye, name, lock, count, menu; layers dropped on it go in it.
import { t, tn } from '../../../../../core/i18n.ts'
import { el } from 'redom'
import { isOwner } from '../../../model/model.ts'
import type { UserLayer } from '../../../model/model.ts'
import { eyeIcon } from '../../../../../ui/icons.ts'
import { withContextMenu } from '../../../../../ui/context-menu.ts'
import { button, focusable } from '../widgets.ts'
import { nameInput, startEditing } from '../editing.ts'
import { folderMenu, moveToFolder } from '../menus.ts'
import { dropTarget } from '../drag.ts'
import type { OutlinerContext } from '../types.ts'

export function folderRow(
  c: OutlinerContext,
  folder: string,
  layers: UserLayer[],
  body: HTMLElement[]
): HTMLElement {
  const store = c.store
  const live = store.view.live
  const folded = c.personal.data.folded.includes(folder)
  const renaming = c.editing?.kind === 'folder' && c.editing.id === folder
  const allHidden = layers.length > 0 && layers.every((l) => store.hidden.has(l.id))
  // Only a layer's owner locks it: the folder's lock acts on those.
  const lockable = layers.filter((l) => isOwner(l) && store.view.canChangeLayer(l))
  const allLocked = lockable.length > 0 && lockable.every((l) => l.style.locked)
  const label = renaming ? nameInput(c) : el('span.oim-ul-folder-label', `${folded ? '▸' : '▾'} 📁 ${folder}`)
  if (!renaming && live)
    label.addEventListener('dblclick', (e) => {
      e.stopPropagation()
      startEditing(c, 'folder', folder)
    })
  const header = el(
    '.oim-ul-folder-row',
    {
      'aria-expanded': String(!folded),
      title: t('userlayers.layer-row-title', 'Click: open · right-click: more')
    },
    button(
      eyeIcon(!allHidden),
      () => layers.forEach((l) => store.setHidden(l.id, !allHidden)),
      t('userlayers.folder-eye', 'Show or hide all its layers')
    ),
    label,
    allLocked
      ? el('span.oim-ul-row-icon', '🔒', {
          title: t('userlayers.folder-locked', 'All its layers are locked')
        })
      : '',
    el(
      'span.oim-ul-count-badge',
      tn('userlayers.n-layers', '{{count}} layer', '{{count}} layers', layers.length)
    )
  )
  withContextMenu(header, () => folderMenu(c, folder, layers, lockable, allLocked))
  header.onclick = () => {
    c.personal.toggle('folded', folder, !folded)
    c.actions.update()
  }
  // Drop a layer here to put it in the folder.
  dropTarget(header, undefined, (id) => {
    const layer = store.layers.get(id)
    if (layer) moveToFolder(c, layer, folder)
  })
  if (!renaming) focusable(c, header, `folder:${folder}`)
  const inside = body.length
    ? body
    : [el('li.oim-ul-hint', t('userlayers.empty-folder', 'Empty: drag layers here.'))]
  return el('li.oim-ul-folder', header, folded ? '' : el('ul.oim-ul-layers', inside))
}
