// Fork: the outliner of My layers (the sidebar's list, docs/plans/my-layers-v3.md):
// folders (optional, one level) holding layers, layers holding items. Items show
// their symbol and what matters at a glance; a search box (items, and layers and
// folders by name) and filter chips narrow the list; layers can be locked; items are
// dragged onto another layer to move them, layers above or below another to reorder
// them (the top one is drawn on top) and onto a folder to put them in it. Names are
// typed in place (double-click, or Rename). Folders, the order, which layers are open
// and which folders folded are yours (state/personal.ts): others sharing a layer
// order and file it their own way. Rows can be reached with Tab; Enter opens or
// selects.
import { t, tn } from '../../../../core/i18n.ts'
import { el } from 'redom'
import { DEFAULT_COLOR, isOwner, UserFeature, UserLayer } from '../../model/model.ts'
import { Store } from '../../state/store.ts'
import { kindOf } from '../../kinds/index.ts'
import { featureLabelParts } from '../../model/labels.ts'
import { symbolRenderer } from '../../map/symbols.ts'
import { openSharing } from '../sharing.ts'
import { Editing, Filter, OutlinerActions } from './types.ts'
import { FILTERS, FORMATS, ITEMS_SHOWN } from './constants.ts'
import { matches, textMatches } from './filter.ts'
import { byFolder, layerOrder, placed, sortLayers } from './order.ts'

export class Outliner {
  el: HTMLElement = el('.oim-ul-outliner')
  query = ''
  filters = new Set<Filter>()
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
    this.el.append(this.search, this.chipsBox, this.body)
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

  /** A submenu of the file formats, downloading the layers given. */
  private exportMenu(title: string, layers: () => UserLayer[]): HTMLElement {
    return el(
      'details.oim-ul-submenu',
      el('summary', title),
      ...FORMATS.map(([format, label]) =>
        this.button(label, () => this.actions.exportLayers(layers(), format), '', 'oim-ul-menu-text')
      )
    )
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

  private button(label: string, onclick: () => void, title = '', className = '') {
    const b = el(`button.oim-ul-button.oim-ul-icon${className ? '.' + className : ''}`, label, {
      type: 'button',
      title,
      'aria-label': title || label
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

  /** The lock: only the layer's owner can lock or unlock it. */
  private lockButton(layer: UserLayer, locked: boolean, mayLock: boolean): HTMLElement {
    const button = this.button(
      locked ? '🔒' : '🔓',
      () => this.store.updateLayer(layer.id, { style: { ...layer.style, locked: !locked || undefined } }),
      !mayLock
        ? t('userlayers.lock-owner', 'Only its owner can lock or unlock it')
        : locked
          ? t('userlayers.unlock', 'Locked: click to allow changes')
          : t('userlayers.lock', 'Lock: no changes to its items'),
      locked ? 'oim-ul-locked' : 'oim-ul-unlocked'
    ) as HTMLButtonElement
    button.disabled = !mayLock
    return button
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
    const color = this.layerColour(layer, changeable)
    const menu = this.layerMenu(layer, owner, changeable)
    const label = this.layerLabel(layer, open, renaming, changeable)
    const header = el(
      `.oim-ul-layer-row${active ? '.active' : ''}`,
      { draggable: this.store.view.live && !renaming, 'aria-expanded': String(open) },
      this.button(
        hidden ? '◌' : '◉',
        () => store.setHidden(layer.id, !hidden),
        hidden ? t('userlayers.show', 'Show on the map') : t('userlayers.hide', 'Hide from the map')
      ),
      this.lockButton(layer, locked, owner && changeable),
      color,
      label,
      owner ? '' : this.sharedTag(layer),
      active ? el('span.oim-ul-active-tag', t('userlayers.active', 'drawing here')) : '',
      el(
        'span.oim-ul-count-badge',
        searching ? `${items.length}/${layer.features.size}` : String(layer.features.size)
      ),
      menu
    )
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

  /** A layer's colour, changed in place. */
  private layerColour(layer: UserLayer, changeable: boolean): HTMLInputElement {
    const store = this.store
    const color = el('input.oim-ul-color', {
      type: 'color',
      value: layer.style.color ?? DEFAULT_COLOR,
      disabled: !changeable,
      title: t('userlayers.layer-color', 'Colour of its drawings and markers')
    }) as HTMLInputElement
    color.onclick = (e) => e.stopPropagation()
    color.onchange = () => store.updateLayer(layer.id, { style: { ...layer.style, color: color.value } })
    return color
  }

  /** Move a layer to a folder: the folders there are, a new one, or out of its folder. */
  private folderMenu(layer: UserLayer): HTMLElement {
    const current = this.folderOf(layer)
    return el(
      'details.oim-ul-submenu',
      el('summary', t('userlayers.move-to-folder-menu', 'Move to folder')),
      ...this.folderNames()
        .filter((f) => f !== current)
        .map((f) => this.button(`📁 ${f}`, () => this.moveToFolder(layer, f), '', 'oim-ul-menu-text')),
      this.button(
        `+ ${t('userlayers.new-folder-dots', 'New folder…')}`,
        () => {
          const name = this.freeName(t('userlayers.new-folder-name', 'New folder'), this.folderNames())
          this.moveToFolder(layer, name)
          this.startEditing('folder', name)
        },
        '',
        'oim-ul-menu-text'
      ),
      current
        ? this.button(
            t('userlayers.out-of-folder', 'Out of the folder'),
            () => this.moveToFolder(layer, null),
            '',
            'oim-ul-menu-text'
          )
        : ''
    )
  }

  /** A layer's ⋯ menu: draw into it, zoom, share, rename, folders, export, delete. */
  private layerMenu(layer: UserLayer, owner: boolean, changeable: boolean): HTMLDetailsElement {
    const store = this.store
    const folders = this.folderMenu(layer)
    const exportMenu = this.exportMenu(t('userlayers.export-as', 'Export as'), () => [layer])
    const menu = el(
      'details.oim-ul-menu',
      el('summary', '⋯', { title: t('userlayers.more', 'More') }),
      el(
        '.oim-ul-menu-items',
        changeable
          ? this.button(
              t('userlayers.draw-here', 'Draw into this layer'),
              () => store.setActive(layer.id),
              '',
              'oim-ul-menu-text'
            )
          : el('p.oim-ul-menu-note', t('userlayers.view-only', 'Shared with you to view only')),
        layer.features.size
          ? this.button(
              t('userlayers.zoom-to-layer', 'Zoom to its items'),
              () => this.actions.zoomToLayer(layer),
              '',
              'oim-ul-menu-text'
            )
          : '',
        owner && layer.access !== undefined
          ? this.button(t('userlayers.share', 'Share…'), () => openSharing(layer), '', 'oim-ul-menu-text')
          : '',
        changeable
          ? this.button(
              t('userlayers.rename', 'Rename'),
              () => this.startEditing('layer', layer.id),
              '',
              'oim-ul-menu-text'
            )
          : '',
        // Your own folders: even a layer you may only view goes in one.
        store.view.live ? folders : '',
        exportMenu,
        owner
          ? this.button(
              t('userlayers.delete', 'Delete'),
              () => {
                const message = tn(
                  'userlayers.delete-layer',
                  'Delete the layer "{{name}}" and its item?',
                  'Delete the layer "{{name}}" and its {{count}} items?',
                  layer.features.size,
                  { name: layer.name }
                )
                if (window.confirm(message)) store.deleteLayer(layer.id)
              },
              '',
              'oim-ul-menu-text'
            )
          : ''
      )
    ) as HTMLDetailsElement
    // The list scrolls (and would cut the menu off): it floats beside its button,
    // above it when there's no room below.
    menu.ontoggle = () => {
      const items = menu.querySelector<HTMLElement>('.oim-ul-menu-items')
      if (!menu.open || !items) return
      const box = menu.getBoundingClientRect()
      items.classList.add('oim-ul-floating')
      items.style.right = `${window.innerWidth - box.right}px`
      const below = window.innerHeight - box.bottom > 220
      items.style.top = below ? `${box.bottom}px` : ''
      items.style.bottom = below ? '' : `${window.innerHeight - box.top}px`
    }
    return menu
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

  /** A layer's items, the first ITEMS_SHOWN of a long one, then "Show the other…". */
  private layerItems(layer: UserLayer, items: UserFeature[], searching: boolean): HTMLElement {
    const all = this.showAll.has(layer.id)
    const shown = all ? items : items.slice(0, ITEMS_SHOWN)
    const more = el(
      'li.oim-ul-more',
      el(
        'button.oim-ul-button',
        tn(
          'userlayers.show-more',
          'Show the other item',
          'Show the other {{count}} items',
          items.length - shown.length
        ),
        { type: 'button' }
      )
    )
    more.onclick = () => {
      this.showAll.add(layer.id)
      this.actions.update()
    }
    return el(
      'ul.oim-ul-items',
      items.length
        ? [...shown.map((f) => this.item(f, layer)), ...(shown.length < items.length ? [more] : [])]
        : el(
            'li.oim-ul-hint',
            searching
              ? t('userlayers.no-match', 'Nothing matches.')
              : t('userlayers.empty-layer', 'Nothing in it yet.')
          )
    )
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
    const lock = this.button(
      allLocked ? '🔒' : '🔓',
      () =>
        lockable.forEach((l) =>
          store.updateLayer(l.id, { style: { ...l.style, locked: !allLocked || undefined } })
        ),
      lockable.length
        ? t('userlayers.folder-lock', 'Lock or unlock all its layers (yours)')
        : t('userlayers.folder-lock-none', 'None of its layers is yours to lock'),
      allLocked ? 'oim-ul-locked' : 'oim-ul-unlocked'
    )
    lock.disabled = !lockable.length
    const add = this.button(
      '+',
      () => this.actions.newLayer(folder),
      t('userlayers.folder-new-layer', 'New layer in this folder')
    )
    add.disabled = !live
    const rename = this.button(
      '✎',
      () => this.startEditing('folder', folder),
      t('userlayers.rename-folder-title', 'Rename the folder (empty: take its layers out)')
    )
    rename.disabled = !live
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
      { 'aria-expanded': String(!folded) },
      this.button(
        allHidden ? '◌' : '◉',
        () => layers.forEach((l) => store.setHidden(l.id, !allHidden)),
        t('userlayers.folder-eye', 'Show or hide all its layers')
      ),
      lock,
      label,
      el(
        'span.oim-ul-count-badge',
        tn('userlayers.n-layers', '{{count}} layer', '{{count}} layers', layers.length)
      ),
      add,
      rename
    )
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

  /** The whole list, drawn again from the store. */
  /** The filter chips (enemy, friendly, planned…). */
  private filterChips(): HTMLElement {
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
  private bottomButtons(): HTMLElement[] {
    const store = this.store
    const create = el('button.oim-ul-button', `+ ${t('userlayers.new-layer', 'New layer')}`, {
      type: 'button'
    })
    create.onclick = () => this.actions.newLayer()
    const createFolder = el('button.oim-ul-button', `+ ${t('userlayers.new-folder', 'New folder')}`, {
      type: 'button',
      title: t('userlayers.new-folder-title', 'A folder to drag layers into')
    })
    createFolder.onclick = () => this.newFolder()
    const importButton = el('button.oim-ul-button', `⤓ ${t('userlayers.import', 'Import a file…')}`, {
      type: 'button',
      title: t('userlayers.import-title', 'GeoJSON, KML or GPX: a new layer with what it has')
    })
    importButton.onclick = () => this.actions.importFile()
    // The layers shown (a situation's, while one is shown).
    const shown = () =>
      [...(this.past ?? store.layers).values()].filter((l) => this.past || !store.hidden.has(l.id))
    const exportAll = shown().length
      ? el(
          'details.oim-ul-menu.oim-ul-export',
          el('summary.oim-ul-button', `⤒ ${t('userlayers.export', 'Export…')}`),
          el(
            '.oim-ul-menu-items',
            el('p.oim-ul-menu-note', t('userlayers.export-shown', 'The layers shown, as')),
            ...FORMATS.map(([format, label]) =>
              this.button(label, () => this.actions.exportLayers(shown(), format), '', 'oim-ul-menu-text')
            )
          )
        )
      : ''
    return [
      el('.oim-ul-row', create, this.past ? '' : createFolder),
      el('.oim-ul-row', this.past ? '' : importButton, exportAll)
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
          ),
      ...this.bottomButtons()
    )
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
