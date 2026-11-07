// Fork: the outliner of My layers (the sidebar's list, docs/plans/my-layers-v3.md):
// folders (optional, one level) holding layers, layers holding items. Items show
// their symbol and what matters at a glance; a search box (items, and layers and
// folders by name) and filters (Filter: chips) narrow the list. A layer's and a
// folder's actions are in their right-click menu (ui/context-menu.ts); items are
// dragged onto another layer to move them, layers above or below another to reorder
// them (the top one is drawn on top) and onto a folder to put them in it. Names are
// typed in place (double-click, or Rename). Folders, the order, which layers are open
// and which folders folded are yours (state/personal.ts): others sharing a layer
// order and file it their own way. Rows can be reached with Tab; Enter opens or
// selects; the Menu key or Shift+F10 opens a row's menu. The buttons under the list
// (new layer, folder, import, export) are in `footer`, which doesn't scroll.
//
// This class keeps the list's state and draws the tree; the parts: rows/ (item,
// layer, folder), menus.ts, editing.ts, drag.ts, footer.ts, widgets.ts, working on
// OutlinerContext (types.ts), which the Outliner is.
import { t } from '../../../../core/i18n.ts'
import { el } from 'redom'
import type { UserLayer } from '../../model/model.ts'
import type { Store } from '../../state/store.ts'
import type { Editing, Filter, OutlinerActions, OutlinerContext } from './types.ts'
import { matches, textMatches } from './filter.ts'
import { byFolder, sortLayers } from './order.ts'
import { layerRow } from './rows/layer.ts'
import { folderRow } from './rows/folder.ts'
import { dropOutRow } from './drag.ts'
import { filterChips, footerButtons } from './footer.ts'
import { newFolder, startEditing } from './editing.ts'

export class Outliner implements OutlinerContext {
  el: HTMLElement = el('.oim-ul-outliner')
  /** New layer, new folder, import, export: under the list, not scrolled with it. */
  readonly footer: HTMLElement = el('.oim-ul-footer')
  query = ''
  filters = new Set<Filter>()
  filtersOpen = false
  readonly filterButton = el('button.oim-ul-button.oim-ul-filter-button', {
    type: 'button'
  }) as HTMLButtonElement
  get past(): Map<string, UserLayer> | null {
    return this.store.view.past
  }
  readonly store: Store
  readonly actions: OutlinerActions
  render?: (sidc: string, size?: number) => string
  private search: HTMLInputElement
  // Only these are drawn again; the search box stays (and keeps the focus).
  private chipsBox = el('div')
  private body = el('div')
  editing: Editing | null = null
  showAll = new Set<string>()
  shownItems: string[] = []
  anchor: string | null = null
  focusKey: string | null = null

  constructor(store: Store, actions: OutlinerActions) {
    this.store = store
    this.actions = actions
    this.search = el('input.oim-ul-outline-search', {
      type: 'search',
      placeholder: t('userlayers.outline-search', 'Search your layers…'),
      'aria-label': t('userlayers.outline-search', 'Search your layers…')
    }) as HTMLInputElement
    this.search.oninput = () => {
      this.query = this.search.value
      this.actions.update()
    }
    this.filterButton.onclick = () => {
      this.filtersOpen = !this.filtersOpen
      this.actions.update()
    }
    this.el.append(el('.oim-ul-search-row', this.search, this.filterButton), this.chipsBox, this.body)
  }

  // Folders, the order, open layers, folded folders: yours (state/personal.ts).
  get personal() {
    return this.store.personal
  }

  folderOf = (layer: UserLayer) => this.personal.folderOf(layer)

  /** Start typing a layer's or folder's name in place. */
  startEditing(kind: Editing['kind'], id: string) {
    startEditing(this, kind, id)
  }

  /** "+ New folder": shown at once, empty, its name ready to type. */
  newFolder() {
    newFolder(this)
  }

  /** The folders and layers, each layer with its items (filtered by the search and chips). */
  private tree(searching: boolean): HTMLElement {
    const store = this.store
    const tree = el(`ul.oim-ul-tree${this.past ? '.oim-ul-readonly' : ''}`)
    // A new folder a layer is now in is a real one.
    const used = new Set([...store.layers.values()].map(this.folderOf))
    for (const f of this.personal.data.empty) if (used.has(f)) this.personal.toggle('empty', f, false)
    const empty = this.past || searching ? [] : this.personal.data.empty
    const layers = sortLayers([...(this.past ?? store.layers).values()], this.personal.data.order)
    for (const [folder, inFolder] of byFolder(layers, empty, this.folderOf)) {
      // A folder whose name matches the search: all its layers.
      const folderMatches = Boolean(folder && this.query.trim() && textMatches(folder, this.query))
      const rows: HTMLElement[] = []
      for (const layer of inFolder) {
        // A layer whose name matches: all its items (the chips still apply).
        const byName = folderMatches || Boolean(this.query.trim() && textMatches(layer.name, this.query))
        const query = byName ? '' : this.query
        const items = [...layer.features.values()].filter((f) => matches(f, query, this.filters))
        if (searching && !items.length && !byName) continue
        rows.push(layerRow(this, layer, items, searching))
      }
      if (!rows.length && (inFolder.length || searching)) continue
      if (folder) tree.append(folderRow(this, folder, inFolder, rows))
      else rows.forEach((r) => tree.append(r))
    }
    return tree
  }

  draw(): HTMLElement {
    const store = this.store
    this.shownItems = []
    const searching = Boolean(this.query.trim()) || this.filters.size > 0
    const tree = this.tree(searching)
    const loose = dropOutRow(this)
    if (loose) tree.append(loose)
    // The row that had the keyboard focus (drawing again replaces it).
    const hadFocus = this.body.contains(document.activeElement) ? this.focusKey : null
    this.chipsBox.replaceChildren(filterChips(this))
    this.body.replaceChildren(
      store.layers.size
        ? searching && !tree.childElementCount
          ? el('p.oim-ul-hint', t('userlayers.no-match', 'Nothing matches.'))
          : tree
        : el(
            'p.oim-ul-hint',
            t(
              'userlayers.no-layers',
              'No layer yet: pick a tool in the toolbar above the map, a layer is made for you.'
            )
          )
    )
    this.footer.replaceChildren(...footerButtons(this))
    this.restoreFocus(hadFocus)
    return this.el
  }

  /** After drawing again: a name being typed keeps the focus, else the row that had it. */
  private restoreFocus(hadFocus: string | null) {
    // A name being typed: its field keeps the focus (and the text, selected at first).
    const input = this.body.querySelector<HTMLInputElement>('input.oim-ul-rename')
    if (input && this.editing) {
      input.focus()
      if (this.editing.fresh) input.select()
      else input.setSelectionRange(input.value.length, input.value.length)
      this.editing.fresh = false
    } else if (hadFocus) {
      this.body.querySelector<HTMLElement>(`[data-key="${CSS.escape(hadFocus)}"]`)?.focus()
    }
  }
}
