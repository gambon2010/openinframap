// Fork: My layers' list (outliner/index.ts): the filter chips, and the buttons under the list (new layer, folder, import, export).
import { t } from '../../../../core/i18n.ts'
import { el } from 'redom'
import { openContextMenuFor } from '../../../../ui/context-menu.ts'
import { FILTERS } from './constants.ts'
import { newFolder } from './editing.ts'
import { exportEntries } from './menus.ts'
import type { OutlinerContext } from './types.ts'

/** The filter chips (enemy, friendly, planned…), shown with Filter (or when on). */
export function filterChips(c: OutlinerContext): HTMLElement | string {
  const on = c.filters.size
  c.filterButton.textContent = on
    ? t('userlayers.filter-on', 'Filter ({{count}})', { count: on })
    : t('userlayers.filter-button', 'Filter')
  c.filterButton.classList.toggle('oim-on', c.filtersOpen || on > 0)
  c.filterButton.setAttribute('aria-expanded', String(c.filtersOpen))
  if (!c.filtersOpen) return ''
  return el(
    '.oim-ul-chips.oim-ul-filters',
    FILTERS.map(([filter, label]) => {
      const on = c.filters.has(filter)
      const b = el(`button.oim-ul-chip${on ? '.oim-on' : ''}`, t(`userlayers.filter.${filter}`, label), {
        type: 'button',
        'aria-pressed': String(on)
      })
      b.onclick = () => {
        if (on) c.filters.delete(filter)
        else c.filters.add(filter)
        c.actions.update()
      }
      return b
    })
  )
}

/** New layer, new folder; import, export (not while a situation is shown). */
export function footerButtons(c: OutlinerContext): (HTMLElement | string)[] {
  const store = c.store
  const button = (label: string | HTMLElement, title: string, onclick: (b: HTMLButtonElement) => void) => {
    const b = el('button.oim-ul-button', label, { type: 'button', title }) as HTMLButtonElement
    b.onclick = () => onclick(b)
    return b
  }
  // The layers shown (a situation's, while one is shown).
  const shown = () => [...(c.past ?? store.layers).values()].filter((l) => c.past || !store.hidden.has(l.id))
  return [
    c.past
      ? ''
      : button(`+ ${t('userlayers.new-layer-short', 'Layer')}`, t('userlayers.new-layer', 'New layer'), () =>
          c.actions.newLayer()
        ),
    c.past
      ? ''
      : button(
          `+ ${t('userlayers.new-folder-short', 'Folder')}`,
          t('userlayers.new-folder-title', 'A folder to drag layers into'),
          () => newFolder(c)
        ),
    el('span.oim-ul-footer-gap'),
    c.past
      ? ''
      : button(
          '⤓',
          t('userlayers.import-title', 'Import a file: GeoJSON, KML or GPX (a new layer with what it has)'),
          () => c.actions.importFile()
        ),
    shown().length
      ? button(el('span.oim-ul-flip', '⤓'), t('userlayers.export-title', 'Export the layers shown'), (b) =>
          openContextMenuFor(b, [
            { heading: t('userlayers.export-shown', 'The layers shown, as') },
            ...exportEntries(c, shown)
          ])
        )
      : ''
  ]
}
