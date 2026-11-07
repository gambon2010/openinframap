// Fork: My layers' list (outliner/index.ts): a layer's row and its items, by group (folding), the first ITEMS_SHOWN of a long one.
import { t, tn } from '../../../../../core/i18n.ts'
import { el } from 'redom'
import { isOwner } from '../../../model/model.ts'
import type { UserFeature, UserLayer } from '../../../model/model.ts'
import { eyeIcon } from '../../../../../ui/icons.ts'
import { withContextMenu } from '../../../../../ui/context-menu.ts'
import type { ItemGroup } from '../types.ts'
import { ITEMS_SHOWN, ITEM_GROUPS } from '../constants.ts'
import { groupItems } from '../groups.ts'
import { button, focusable } from '../widgets.ts'
import { nameInput, startEditing } from '../editing.ts'
import { layerMenu } from '../menus.ts'
import { layerDropTarget } from '../drag.ts'
import { item } from './item.ts'
import type { OutlinerContext } from '../types.ts'

export function layerRow(
  c: OutlinerContext,
  layer: UserLayer,
  items: UserFeature[],
  searching: boolean
): HTMLElement {
  const store = c.store
  const hidden = store.hidden.has(layer.id)
  const locked = Boolean(layer.style.locked)
  const open = searching || c.personal.data.expanded.includes(layer.id)
  const active = layer.id === store.activeLayer
  // Shared with you: whose it is; to view only, nothing of it can be changed.
  const owner = isOwner(layer)
  const changeable = store.view.canChangeLayer(layer)
  const renaming = c.editing?.kind === 'layer' && c.editing.id === layer.id
  const label = layerLabel(c, layer, open, renaming, changeable)
  const header = el(
    `.oim-ul-layer-row${active ? '.active' : ''}`,
    {
      draggable: c.store.view.live && !renaming,
      'aria-expanded': String(open),
      title: t('userlayers.layer-row-title', 'Click: open · right-click: more')
    },
    button(
      eyeIcon(!hidden),
      () => store.setHidden(layer.id, !hidden),
      hidden ? t('userlayers.show', 'Show on the map') : t('userlayers.hide', 'Hide from the map')
    ),
    label,
    owner ? '' : sharedTag(layer),
    locked
      ? el('span.oim-ul-row-icon', '🔒', {
          title: t('userlayers.locked-layer', 'Locked: no changes to its items')
        })
      : '',
    active
      ? el('span.oim-ul-row-icon.oim-ul-active-tag', '✎', {
          title: t('userlayers.active', 'You draw into this layer')
        })
      : '',
    el(
      'span.oim-ul-count-badge',
      searching ? `${items.length}/${layer.features.size}` : String(layer.features.size)
    )
  )
  withContextMenu(header, () => layerMenu(c, layer, owner, changeable))
  header.onclick = () => {
    c.personal.toggle('expanded', layer.id, !c.personal.data.expanded.includes(layer.id))
    c.actions.update()
  }
  header.ondragstart = (e) => {
    if ((e.target as HTMLElement).closest('.oim-ul-item')) return
    e.dataTransfer?.setData('application/x-oim-layer', layer.id)
    // While a layer is dragged, the place to drop it out of its folder shows.
    c.el.classList.add('oim-ul-dragging-layer')
  }
  header.ondragend = () => c.el.classList.remove('oim-ul-dragging-layer')
  layerDropTarget(c, header, layer)
  if (!renaming) focusable(c, header, `layer:${layer.id}`)
  const li = el(`li.oim-ul-layer${hidden ? '.hidden' : ''}`, header)
  if (open) li.append(layerItems(c, layer, items, searching))
  return li
}

/** A layer's name (a text box while it's renamed). */
export function layerLabel(
  c: OutlinerContext,
  layer: UserLayer,
  open: boolean,
  renaming: boolean,
  changeable: boolean
): HTMLElement {
  const label = renaming
    ? nameInput(c)
    : el('span.oim-ul-layer-label', `${open ? '▾' : '▸'} ${layer.name}`, {
        title: changeable ? t('userlayers.rename-hint', 'Double-click to rename') : ''
      })
  if (!renaming && changeable)
    label.addEventListener('dblclick', (e) => {
      e.stopPropagation()
      startEditing(c, 'layer', layer.id)
    })
  return label
}

/** Someone else's layer: whose it is, and whether you may change it. */
export function sharedTag(layer: UserLayer): HTMLElement {
  return el('span.oim-ul-shared-tag', layer.access === 'view' ? '👁' : '👥', {
    title:
      layer.access === 'view'
        ? t('userlayers.shared-view', "{{owner}}'s, shared with you to view", {
            owner: layer.owner ?? '?'
          })
        : t('userlayers.shared-modify', "{{owner}}'s, shared with you to change", {
            owner: layer.owner ?? '?'
          })
  })
}

/** A layer's items by group (groups.ts), each group folding; the first
 * ITEMS_SHOWN of a long layer, then "Show the other…". */
export function layerItems(
  c: OutlinerContext,
  layer: UserLayer,
  items: UserFeature[],
  searching: boolean
): HTMLElement {
  if (!items.length)
    return el(
      'ul.oim-ul-items',
      el(
        'li.oim-ul-hint',
        searching
          ? t('userlayers.no-match', 'Nothing matches.')
          : t('userlayers.empty-layer', 'Nothing in it yet.')
      )
    )
  let room = c.showAll.has(layer.id) ? Infinity : ITEMS_SHOWN
  let notShown = 0
  const rows: HTMLElement[] = []
  for (const [group, inGroup] of groupItems(items)) {
    const key = `${layer.id}/${group}`
    // Searching: every group open, to show what matches.
    const folded = !searching && c.personal.data.foldedGroups.includes(key)
    rows.push(groupRow(c, key, group, inGroup.length, folded))
    if (folded) continue
    const shown = inGroup.slice(0, room)
    room -= shown.length
    notShown += inGroup.length - shown.length
    rows.push(...shown.map((f) => item(c, f, layer)))
  }
  if (notShown) {
    const more = el(
      'li.oim-ul-more',
      el(
        'button.oim-ul-button',
        tn('userlayers.show-more', 'Show the other item', 'Show the other {{count}} items', notShown),
        { type: 'button' }
      )
    )
    more.onclick = () => {
      c.showAll.add(layer.id)
      c.actions.update()
    }
    rows.push(more)
  }
  return el('ul.oim-ul-items', rows)
}

/** A group's heading in a layer: its name and count; a click folds it (yours). */
export function groupRow(
  c: OutlinerContext,
  key: string,
  group: ItemGroup,
  count: number,
  folded: boolean
): HTMLElement {
  const label = ITEM_GROUPS.find(([g]) => g === group)?.[1] ?? group
  const row = el(
    'li.oim-ul-item-group',
    { 'aria-expanded': String(!folded) },
    el('span.oim-ul-item-group-label', `${folded ? '▸' : '▾'} ${t(`userlayers.item-group.${group}`, label)}`),
    el('span.oim-ul-count-badge', String(count))
  )
  row.onclick = () => {
    c.personal.toggle('foldedGroups', key, !folded)
    c.actions.update()
  }
  focusable(c, row, `group:${key}`)
  return row
}
