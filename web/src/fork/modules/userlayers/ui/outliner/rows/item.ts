// Fork: My layers' list (outliner/index.ts): an item's row: its picture, name and details; click, Ctrl-click, Shift-click a range.
import { t } from '../../../../../core/i18n.ts'
import { el } from 'redom'
import type { UserFeature, UserLayer } from '../../../model/model.ts'
import { kindOf } from '../../../kinds/index.ts'
import { featureLabelParts } from '../../../model/labels.ts'
import { symbolRenderer } from '../../../map/symbols.ts'
import { graphicsLibrary, graphicsReady } from '../../../graphics/graphics.ts'
import { focusable } from '../widgets.ts'
import type { OutlinerContext } from '../types.ts'

/** A small picture of an item for the list. */
export function thumbnail(c: OutlinerContext, feature: UserFeature): HTMLElement {
  const p = feature.properties
  const span = el('span.oim-ul-thumb')
  const thumbnail = kindOf(p).thumbnail(feature, c.render)
  if (thumbnail === null) {
    span.textContent = '⬚'
    // The symbol library loads once; draw the list again then.
    void symbolRenderer().then((render) => {
      if (!c.render) {
        c.render = render
        c.actions.update()
      }
    })
  } else span.append(thumbnail)
  return span
}

/** The items shown from the last one clicked (else the main selected one) to `id`. */
export function range(c: OutlinerContext, id: string): string[] {
  const from = c.anchor && c.shownItems.includes(c.anchor) ? c.anchor : c.actions.selection()[0]
  const a = from ? c.shownItems.indexOf(from) : -1
  const b = c.shownItems.indexOf(id)
  if (a < 0 || b < 0) return [id]
  return c.shownItems.slice(Math.min(a, b), Math.max(a, b) + 1)
}

export function item(c: OutlinerContext, feature: UserFeature, layer: UserLayer): HTMLElement {
  c.shownItems.push(feature.id)
  // A graphic's name may come from the renderer (a type the catalogue no longer
  // lists): once it has loaded, the list is drawn again.
  if (kindOf(feature.properties).id === 'graphic' && !graphicsReady())
    void graphicsLibrary().then(() => c.actions.update())
  const { name, what, detail } = featureLabelParts(feature)
  const selected = c.actions.isSelected(feature.id)
  const row = el(
    `li.oim-ul-item${selected ? '.oim-on' : ''}`,
    {
      draggable: c.store.view.canEditItem(layer, feature),
      'aria-selected': String(selected),
      title: t(
        'userlayers.item-title',
        'Click: select · Ctrl-click: add · Shift-click: all down to here · drag onto a layer: move'
      )
    },
    thumbnail(c, feature),
    el(
      'span.oim-ul-item-text',
      el('span.oim-ul-item-name', name || what),
      el('small', name ? [what, detail].filter(Boolean).join(' · ') : detail)
    ),
    feature.properties.locked
      ? el('span.oim-ul-item-locked', '🔒', { title: t('userlayers.item-locked', 'Locked') })
      : '',
    c.store.isFeatureInConflict(feature.id)
      ? el('span.oim-ul-conflict-tag', '⚠', {
          title: t(
            'userlayers.in-conflict',
            'In conflict with someone else’s change: see the conflict window'
          )
        })
      : ''
  )
  // Click: this one. Ctrl / Cmd-click: add or take out. Shift-click: everything
  // shown between the last item clicked and this one, added.
  row.onclick = (e) => {
    if (e.shiftKey) {
      c.actions.selectMore(range(c, feature.id))
      return
    }
    c.anchor = feature.id
    c.actions.select(feature, e.ctrlKey || e.metaKey)
  }
  row.ondragstart = (e) => {
    e.dataTransfer?.setData('application/x-oim-item', feature.id)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  }
  focusable(c, row, `item:${feature.id}`)
  return row
}
