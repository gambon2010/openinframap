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
import { t, tn } from '../../../../core/i18n.ts'
import { el } from 'redom'
import { isOwner, UserFeature, UserLayer } from '../../model/model.ts'
import { Store } from '../../state/store.ts'
import { kindOf } from '../../kinds/index.ts'
import { featureLabelParts } from '../../model/labels.ts'
import { symbolRenderer } from '../../map/symbols.ts'
import { openSharing } from '../sharing.ts'
import { eyeIcon } from '../../../../ui/icons.ts'
import { MenuEntry, MenuItem, openContextMenuFor, withContextMenu } from '../../../../ui/context-menu.ts'
import { Editing, Filter, ItemGroup, OutlinerActions } from './types.ts'
import { FILTERS, FORMATS, ITEM_GROUPS, ITEMS_SHOWN } from './constants.ts'
import { groupItems } from './groups.ts'
import { matches, textMatches } from './filter.ts'
import { byFolder, layerOrder, placed, sortLayers } from './order.ts'

export class Outliner {
  el: HTMLElement = el('.oim-ul-outliner')
  /** New layer, new folder, import, export: under the list, not scrolled with it. */
  readonly footer: HTMLElement = el('.oim-ul-footer')
  query = ''
  filters = new Set<Filter>()
  /** The filter chips are showing (Filter). */
  private filtersOpen = false
  private filterButton = el('button.oim-ul-button.oim-ul-filter-button', {
    type: 'button'
  }) as HTMLButtonElement
  /** A situation's layers, shown read-only instead of the live ones (state/view.ts). */
  private get past(): Map<string, UserLayer> | null {
    return this.store.view.past
  }
  private store: Store
  private actions: OutlinerActions
  private render?: (sidc: string, size?: number) => string
  private search: HTMLInputElement
  // Only these are drawn again; the search box stays (and keeps the focus).
  private chipsBox = el('div')
  private body = el('div')
  private editing: Editing | null = null
  /** Layers showing all their items, not only the first ITEMS_SHOWN. */
  private showAll = new Set<string>()
  /** The row that had the keyboard focus, to give it back after drawing again. */
  private focusKey: string | null = null

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
  private get personal() {
    return this.store.personal
  }

  private folderOf = (layer: UserLayer) => this.personal.folderOf(layer)

  /** The folders there are, sorted. */
  private folderNames(): string[] {
    const names = new Set(this.personal.data.empty)
    for (const l of this.store.layers.values()) {
      const folder = this.folderOf(l)
      if (folder) names.add(folder)
    }
    return [...names].sort((a, b) => a.localeCompare(b))
  }

  /** Put a layer in a folder (null: in none): for you only, nothing to save. */
  private moveToFolder(layer: UserLayer, folder: string | null) {
    if (this.folderOf(layer) === folder) return
    this.personal.setFolder(layer.id, folder)
    this.actions.update()
    this.actions.reordered()
  }

  /** Put a layer just above or below another (and in its folder). */
  private placeLayer(id: string, target: UserLayer, before: boolean) {
    const layer = this.store.layers.get(id)
    if (!layer || id === target.id) return
    const order = layerOrder([...this.store.layers.values()], this.personal)
    this.personal.setFolder(id, this.folderOf(target))
    this.personal.setOrder(placed(order, id, target.id, before))
    this.actions.update()
    this.actions.reordered()
  }

  /** The file formats, each downloading the layers given. */
  private exportEntries(layers: () => UserLayer[]): MenuEntry[] {
    return FORMATS.map(([format, label]) => ({
      label,
      run: () => this.actions.exportLayers(layers(), format)
    }))
  }

  /** Start typing a layer's or folder's name in place. */
  startEditing(kind: Editing['kind'], id: string) {
    const value = kind === 'layer' ? (this.store.layers.get(id)?.name ?? '') : id
    this.editing = { kind, id, value, fresh: true }
    // A folder being renamed is open.
    if (kind === 'folder') this.personal.toggle('folded', id, false)
    this.actions.update()
  }

  /** A name nobody uses yet: "New folder", "New folder 2"... */
  private freeName(base: string, taken: string[]): string {
    if (!taken.includes(base)) return base
    let n = 2
    while (taken.includes(`${base} ${n}`)) n++
    return `${base} ${n}`
  }

  /** "+ New folder": shown at once, empty, its name ready to type. */
  newFolder() {
    const name = this.freeName(t('userlayers.new-folder-name', 'New folder'), this.folderNames())
    this.personal.toggle('empty', name, true)
    this.startEditing('folder', name)
  }

  private finishEditing(keep: boolean) {
    const editing = this.editing
    if (!editing) return
    this.editing = null
    const value = editing.value.trim()
    if (keep && editing.kind === 'layer') {
      const layer = this.store.layers.get(editing.id)
      if (layer && value && value !== layer.name) this.store.updateLayer(layer.id, { name: value })
    } else if (keep && editing.kind === 'folder' && value !== editing.id) {
      // Renaming a folder: its layers go with it (empty: out of any folder).
      const layers = [...this.store.layers.values()].filter((l) => this.folderOf(l) === editing.id)
      this.personal.toggle('empty', editing.id, false)
      if (!layers.length && value) this.personal.toggle('empty', value, true)
      for (const l of layers) this.personal.setFolder(l.id, value || null)
    }
    this.actions.update()
  }

  /** The text field a name is typed in, in place of the name. */
  private nameInput(): HTMLInputElement {
    const editing = this.editing!
    const input = el('input.oim-ul-rename', {
      type: 'text',
      value: editing.value,
      'aria-label': t('userlayers.rename', 'Rename')
    }) as HTMLInputElement
    input.oninput = () => (editing.value = input.value)
    input.onkeydown = (e) => {
      e.stopPropagation()
      if (e.key === 'Enter') this.finishEditing(true)
      else if (e.key === 'Escape') this.finishEditing(false)
    }
    input.onblur = () => {
      // Drawn again meanwhile (another change): the new field takes over.
      if (this.editing === editing && input.isConnected) this.finishEditing(true)
    }
    for (const event of ['click', 'dblclick', 'mousedown'] as const)
      input.addEventListener(event, (e) => e.stopPropagation())
    return input
  }

  private button(label: string | Element, onclick: () => void, title = '', className = '') {
    const b = el(`button.oim-ul-button.oim-ul-icon${className ? '.' + className : ''}`, label, {
      type: 'button',
      title,
      'aria-label': title || (typeof label === 'string' ? label : '')
    }) as HTMLButtonElement
    b.onclick = (e) => {
      e.stopPropagation()
      onclick()
    }
    return b
  }

  /** A row reachable with Tab: Enter or Space does what a click does. */
  private focusable(row: HTMLElement, key: string) {
    row.tabIndex = 0
    row.dataset.key = key
    row.addEventListener('keydown', (e) => {
      if (e.target !== row || (e.key !== 'Enter' && e.key !== ' ')) return
      e.preventDefault()
      this.focusKey = key
      row.click()
    })
    row.addEventListener('focus', () => (this.focusKey = key))
  }

  /** A small picture of an item for the list. */
  private thumbnail(feature: UserFeature): HTMLElement {
    const p = feature.properties
    const span = el('span.oim-ul-thumb')
    const thumbnail = kindOf(p).thumbnail(feature, this.render)
    if (thumbnail === null) {
      span.textContent = '⬚'
      // The symbol library loads once; draw the list again then.
      void symbolRenderer().then((render) => {
        if (!this.render) {
          this.render = render
          this.actions.update()
        }
      })
    } else span.append(thumbnail)
    return span
  }

  private item(feature: UserFeature, layer: UserLayer): HTMLElement {
    const { name, what, detail } = featureLabelParts(feature)
    const selected = this.actions.isSelected(feature.id)
    const row = el(
      `li.oim-ul-item${selected ? '.oim-on' : ''}`,
      {
        draggable: this.store.view.canEditItem(layer, feature),
        'aria-selected': String(selected),
        title: t(
          'userlayers.item-title',
          'Click: select · Shift-click: select several · drag onto a layer: move'
        )
      },
      this.thumbnail(feature),
      el(
        'span.oim-ul-item-text',
        el('span.oim-ul-item-name', name || what),
        el('small', name ? [what, detail].filter(Boolean).join(' · ') : detail)
      ),
      feature.properties.locked
        ? el('span.oim-ul-item-locked', '🔒', { title: t('userlayers.item-locked', 'Locked') })
        : '',
      this.store.isFeatureInConflict(feature.id)
        ? el('span.oim-ul-conflict-tag', '⚠', {
            title: t(
              'userlayers.in-conflict',
              'In conflict with someone else’s change: see the conflict window'
            )
          })
        : ''
    )
    // Shift or Ctrl / Cmd-click: add to the selection.
    row.onclick = (e) => this.actions.select(feature, e.shiftKey || e.ctrlKey || e.metaKey)
    row.ondragstart = (e) => {
      e.dataTransfer?.setData('application/x-oim-item', feature.id)
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    }
    this.focusable(row, `item:${feature.id}`)
    return row
  }

  /** Make a row accept items (moved into the layer) or layers (put in the folder). */
  private dropTarget(row: HTMLElement, onItem?: (id: string) => void, onLayer?: (id: string) => void) {
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
  private layerDropTarget(row: HTMLElement, layer: UserLayer) {
    const store = this.store
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
      } else if (dropped) this.placeLayer(dropped, layer, before(e))
    }
  }

  private layerRow(layer: UserLayer, items: UserFeature[], searching: boolean): HTMLElement {
    const store = this.store
    const hidden = store.hidden.has(layer.id)
    const locked = Boolean(layer.style.locked)
    const open = searching || this.personal.data.expanded.includes(layer.id)
    const active = layer.id === store.activeLayer
    // Shared with you: whose it is; to view only, nothing of it can be changed.
    const owner = isOwner(layer)
    const changeable = store.view.canChangeLayer(layer)
    const renaming = this.editing?.kind === 'layer' && this.editing.id === layer.id
    const label = this.layerLabel(layer, open, renaming, changeable)
    const header = el(
      `.oim-ul-layer-row${active ? '.active' : ''}`,
      {
        draggable: this.store.view.live && !renaming,
        'aria-expanded': String(open),
        title: t('userlayers.layer-row-title', 'Click: open · right-click: more')
      },
      this.button(
        eyeIcon(!hidden),
        () => store.setHidden(layer.id, !hidden),
        hidden ? t('userlayers.show', 'Show on the map') : t('userlayers.hide', 'Hide from the map')
      ),
      label,
      owner ? '' : this.sharedTag(layer),
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
    withContextMenu(header, () => this.layerMenu(layer, owner, changeable))
    header.onclick = () => {
      this.personal.toggle('expanded', layer.id, !this.personal.data.expanded.includes(layer.id))
      this.actions.update()
    }
    header.ondragstart = (e) => {
      if ((e.target as HTMLElement).closest('.oim-ul-item')) return
      e.dataTransfer?.setData('application/x-oim-layer', layer.id)
      // While a layer is dragged, the place to drop it out of its folder shows.
      this.el.classList.add('oim-ul-dragging-layer')
    }
    header.ondragend = () => this.el.classList.remove('oim-ul-dragging-layer')
    this.layerDropTarget(header, layer)
    if (!renaming) this.focusable(header, `layer:${layer.id}`)
    const li = el(`li.oim-ul-layer${hidden ? '.hidden' : ''}`, header)
    if (open) li.append(this.layerItems(layer, items, searching))
    return li
  }

  /** "Move to folder": the folders there are, a new one, or out of its folder. */
  private folderEntries(layer: UserLayer): MenuEntry[] {
    const current = this.folderOf(layer)
    return [
      ...this.folderNames()
        .filter((f) => f !== current)
        .map((f) => ({ label: `📁 ${f}`, run: () => this.moveToFolder(layer, f) })),
      {
        label: `+ ${t('userlayers.new-folder-dots', 'New folder…')}`,
        run: () => {
          const name = this.freeName(t('userlayers.new-folder-name', 'New folder'), this.folderNames())
          this.moveToFolder(layer, name)
          this.startEditing('folder', name)
        }
      },
      ...(current
        ? [
            {
              label: t('userlayers.out-of-folder', 'Out of the folder'),
              run: () => this.moveToFolder(layer, null)
            }
          ]
        : [])
    ]
  }

  /** A layer's right-click menu: draw into it, zoom, rename, lock, share, folder,
   * export, delete. */
  private layerMenu(layer: UserLayer, owner: boolean, changeable: boolean): MenuItem[] {
    const store = this.store
    const locked = Boolean(layer.style.locked)
    const items: MenuItem[] = [{ heading: layer.name }]
    if (changeable) {
      items.push({
        label: t('userlayers.draw-here', 'Draw into this layer'),
        run: () => store.setActive(layer.id),
        disabled: layer.id === store.activeLayer
      })
    } else items.push({ heading: t('userlayers.view-only', 'Shared with you to view only') })
    if (layer.features.size)
      items.push({
        label: t('userlayers.zoom-to-layer', 'Zoom to its items'),
        run: () => this.actions.zoomToLayer(layer)
      })
    if (changeable)
      items.push({ label: t('userlayers.rename', 'Rename'), run: () => this.startEditing('layer', layer.id) })
    // Only its owner locks or unlocks it.
    if (owner && changeable)
      items.push({
        label: locked
          ? t('userlayers.unlock', '🔓 Unlock')
          : t('userlayers.lock', '🔒 Lock (no changes to its items)'),
        run: () => store.updateLayer(layer.id, { style: { ...layer.style, locked: !locked || undefined } })
      })
    if (owner && layer.access !== undefined)
      items.push({ label: t('userlayers.share', 'Share…'), run: () => openSharing(layer) })
    // Your own folders: even a layer you may only view goes in one.
    if (store.view.live)
      items.push({
        label: t('userlayers.move-to-folder-menu', 'Move to folder'),
        entries: this.folderEntries(layer)
      })
    items.push({ label: t('userlayers.export-as', 'Export as'), entries: this.exportEntries(() => [layer]) })
    if (owner) {
      items.push('separator', {
        label: t('userlayers.delete', 'Delete'),
        danger: true,
        run: () => {
          const message = tn(
            'userlayers.delete-layer',
            'Delete the layer "{{name}}" and its item?',
            'Delete the layer "{{name}}" and its {{count}} items?',
            layer.features.size,
            { name: layer.name }
          )
          if (window.confirm(message)) store.deleteLayer(layer.id)
        }
      })
    }
    return items
  }

  /** A layer's name (a text box while it's renamed). */
  private layerLabel(layer: UserLayer, open: boolean, renaming: boolean, changeable: boolean): HTMLElement {
    const label = renaming
      ? this.nameInput()
      : el('span.oim-ul-layer-label', `${open ? '▾' : '▸'} ${layer.name}`, {
          title: changeable ? t('userlayers.rename-hint', 'Double-click to rename') : ''
        })
    if (!renaming && changeable)
      label.addEventListener('dblclick', (e) => {
        e.stopPropagation()
        this.startEditing('layer', layer.id)
      })
    return label
  }

  /** Someone else's layer: whose it is, and whether you may change it. */
  private sharedTag(layer: UserLayer): HTMLElement {
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
  private layerItems(layer: UserLayer, items: UserFeature[], searching: boolean): HTMLElement {
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
    let room = this.showAll.has(layer.id) ? Infinity : ITEMS_SHOWN
    let notShown = 0
    const rows: HTMLElement[] = []
    for (const [group, inGroup] of groupItems(items)) {
      const key = `${layer.id}/${group}`
      // Searching: every group open, to show what matches.
      const folded = !searching && this.personal.data.foldedGroups.includes(key)
      rows.push(this.groupRow(key, group, inGroup.length, folded))
      if (folded) continue
      const shown = inGroup.slice(0, room)
      room -= shown.length
      notShown += inGroup.length - shown.length
      rows.push(...shown.map((f) => this.item(f, layer)))
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
        this.showAll.add(layer.id)
        this.actions.update()
      }
      rows.push(more)
    }
    return el('ul.oim-ul-items', rows)
  }

  /** A group's heading in a layer: its name and count; a click folds it (yours). */
  private groupRow(key: string, group: ItemGroup, count: number, folded: boolean): HTMLElement {
    const label = ITEM_GROUPS.find(([g]) => g === group)?.[1] ?? group
    const row = el(
      'li.oim-ul-item-group',
      { 'aria-expanded': String(!folded) },
      el(
        'span.oim-ul-item-group-label',
        `${folded ? '▸' : '▾'} ${t(`userlayers.item-group.${group}`, label)}`
      ),
      el('span.oim-ul-count-badge', String(count))
    )
    row.onclick = () => {
      this.personal.toggle('foldedGroups', key, !folded)
      this.actions.update()
    }
    this.focusable(row, `group:${key}`)
    return row
  }

  /** A folder's right-click menu: a new layer in it, rename, lock, export, remove. */
  private folderMenu(
    folder: string,
    layers: UserLayer[],
    lockable: UserLayer[],
    allLocked: boolean
  ): MenuItem[] {
    const store = this.store
    const live = store.view.live
    const items: MenuItem[] = [{ heading: `📁 ${folder}` }]
    if (live) {
      items.push(
        {
          label: t('userlayers.folder-new-layer', 'New layer in this folder'),
          run: () => this.actions.newLayer(folder)
        },
        { label: t('userlayers.rename', 'Rename'), run: () => this.startEditing('folder', folder) }
      )
    }
    // Only a layer's owner locks it: the folder's lock acts on those.
    if (lockable.length)
      items.push({
        label: allLocked
          ? t('userlayers.folder-unlock', '🔓 Unlock its layers')
          : t('userlayers.folder-lock', '🔒 Lock its layers (yours)'),
        run: () =>
          lockable.forEach((l) =>
            store.updateLayer(l.id, { style: { ...l.style, locked: !allLocked || undefined } })
          )
      })
    if (layers.length)
      items.push({ label: t('userlayers.export-as', 'Export as'), entries: this.exportEntries(() => layers) })
    if (live)
      items.push('separator', {
        label: t('userlayers.remove-folder', 'Remove the folder (its layers stay)'),
        run: () => {
          this.personal.toggle('empty', folder, false)
          for (const l of layers) this.personal.setFolder(l.id, null)
          this.actions.update()
          this.actions.reordered()
        }
      })
    return items
  }

  private folderRow(folder: string, layers: UserLayer[], body: HTMLElement[]): HTMLElement {
    const store = this.store
    const live = store.view.live
    const folded = this.personal.data.folded.includes(folder)
    const renaming = this.editing?.kind === 'folder' && this.editing.id === folder
    const allHidden = layers.length > 0 && layers.every((l) => store.hidden.has(l.id))
    // Only a layer's owner locks it: the folder's lock acts on those.
    const lockable = layers.filter((l) => isOwner(l) && store.view.canChangeLayer(l))
    const allLocked = lockable.length > 0 && lockable.every((l) => l.style.locked)
    const label = renaming
      ? this.nameInput()
      : el('span.oim-ul-folder-label', `${folded ? '▸' : '▾'} 📁 ${folder}`)
    if (!renaming && live)
      label.addEventListener('dblclick', (e) => {
        e.stopPropagation()
        this.startEditing('folder', folder)
      })
    const header = el(
      '.oim-ul-folder-row',
      {
        'aria-expanded': String(!folded),
        title: t('userlayers.layer-row-title', 'Click: open · right-click: more')
      },
      this.button(
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
    withContextMenu(header, () => this.folderMenu(folder, layers, lockable, allLocked))
    header.onclick = () => {
      this.personal.toggle('folded', folder, !folded)
      this.actions.update()
    }
    // Drop a layer here to put it in the folder.
    this.dropTarget(header, undefined, (id) => {
      const layer = store.layers.get(id)
      if (layer) this.moveToFolder(layer, folder)
    })
    if (!renaming) this.focusable(header, `folder:${folder}`)
    const inside = body.length
      ? body
      : [el('li.oim-ul-hint', t('userlayers.empty-folder', 'Empty: drag layers here.'))]
    return el('li.oim-ul-folder', header, folded ? '' : el('ul.oim-ul-layers', inside))
  }

  /** The filter chips (enemy, friendly, planned…), shown with Filter (or when on). */
  private filterChips(): HTMLElement | string {
    const on = this.filters.size
    this.filterButton.textContent = on
      ? t('userlayers.filter-on', 'Filter ({{count}})', { count: on })
      : t('userlayers.filter-button', 'Filter')
    this.filterButton.classList.toggle('oim-on', this.filtersOpen || on > 0)
    this.filterButton.setAttribute('aria-expanded', String(this.filtersOpen))
    if (!this.filtersOpen) return ''
    return el(
      '.oim-ul-chips.oim-ul-filters',
      FILTERS.map(([filter, label]) => {
        const on = this.filters.has(filter)
        const b = el(`button.oim-ul-chip${on ? '.oim-on' : ''}`, t(`userlayers.filter.${filter}`, label), {
          type: 'button',
          'aria-pressed': String(on)
        })
        b.onclick = () => {
          if (on) this.filters.delete(filter)
          else this.filters.add(filter)
          this.actions.update()
        }
        return b
      })
    )
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
        rows.push(this.layerRow(layer, items, searching))
      }
      if (!rows.length && (inFolder.length || searching)) continue
      if (folder) tree.append(this.folderRow(folder, inFolder, rows))
      else rows.forEach((r) => tree.append(r))
    }
    return tree
  }

  /** Where a dragged layer is dropped to take it out of its folder (only with folders). */
  private dropOutRow(): HTMLElement | null {
    const store = this.store
    // Drop a layer on this (it shows while one is dragged): out of its folder.
    const loose = el(
      'li.oim-ul-drop-out',
      t('userlayers.drop-out', 'Drop a layer here to take it out of its folder')
    )
    this.dropTarget(loose, undefined, (id) => {
      const layer = store.layers.get(id)
      if (layer) this.moveToFolder(layer, null)
    })
    return [...store.layers.values()].some((l) => this.folderOf(l)) ? loose : null
  }

  /** New layer, new folder; import, export (not while a situation is shown). */
  private footerButtons(): (HTMLElement | string)[] {
    const store = this.store
    const button = (label: string | HTMLElement, title: string, onclick: (b: HTMLButtonElement) => void) => {
      const b = el('button.oim-ul-button', label, { type: 'button', title }) as HTMLButtonElement
      b.onclick = () => onclick(b)
      return b
    }
    // The layers shown (a situation's, while one is shown).
    const shown = () =>
      [...(this.past ?? store.layers).values()].filter((l) => this.past || !store.hidden.has(l.id))
    return [
      this.past
        ? ''
        : button(
            `+ ${t('userlayers.new-layer-short', 'Layer')}`,
            t('userlayers.new-layer', 'New layer'),
            () => this.actions.newLayer()
          ),
      this.past
        ? ''
        : button(
            `+ ${t('userlayers.new-folder-short', 'Folder')}`,
            t('userlayers.new-folder-title', 'A folder to drag layers into'),
            () => this.newFolder()
          ),
      el('span.oim-ul-footer-gap'),
      this.past
        ? ''
        : button(
            '⤓',
            t('userlayers.import-title', 'Import a file: GeoJSON, KML or GPX (a new layer with what it has)'),
            () => this.actions.importFile()
          ),
      shown().length
        ? button(el('span.oim-ul-flip', '⤓'), t('userlayers.export-title', 'Export the layers shown'), (b) =>
            openContextMenuFor(b, [
              { heading: t('userlayers.export-shown', 'The layers shown, as') },
              ...this.exportEntries(shown)
            ])
          )
        : ''
    ]
  }

  draw(): HTMLElement {
    const store = this.store
    const searching = Boolean(this.query.trim()) || this.filters.size > 0
    const tree = this.tree(searching)
    const loose = this.dropOutRow()
    if (loose) tree.append(loose)
    // The row that had the keyboard focus (drawing again replaces it).
    const hadFocus = this.body.contains(document.activeElement) ? this.focusKey : null
    this.chipsBox.replaceChildren(this.filterChips())
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
    this.footer.replaceChildren(...this.footerButtons())
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
