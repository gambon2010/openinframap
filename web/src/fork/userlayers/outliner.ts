// Fork: the outliner of My layers (the sidebar's list, docs/plans/my-layers-v3.md):
// folders (optional, one level) holding layers, layers holding items. Items show
// their symbol and what matters at a glance; a search box and filter chips narrow
// the list; layers can be locked; items are dragged onto another layer to move them,
// layers onto a folder.
import { tt } from './i18n.ts'
import { el } from 'redom'
import { DEFAULT_COLOR, UserFeature, UserLayer } from './model.ts'
import { Store } from './store.ts'
import { featureLabelParts } from './labels.ts'
import { identity, status, symbolKind } from './sidc.ts'
import { GEOMETRY_LABELS, entryOf } from './palette.ts'
import { symbolRenderer } from './symbols.ts'
import { imageUrl } from './api.ts'

export type Filter = 'hostile' | 'friend' | 'planned' | 'units' | 'graphics' | 'pictures'

export const FILTERS: [Filter, string][] = [
  ['hostile', 'Hostile'],
  ['friend', 'Friend'],
  ['planned', 'Planned'],
  ['units', 'Units'],
  ['graphics', 'Graphics'],
  ['pictures', 'Pictures']
]

/** Whether an item matches the search text (all words, anywhere in its name, type,
 * details or notes) and every filter chip that's on. */
export function matches(feature: UserFeature, query: string, filters: Set<Filter>): boolean {
  const p = feature.properties
  const sidc = p.sidc ?? ''
  for (const filter of filters) {
    if (filter === 'hostile' && !(sidc && ['H', 'S', 'J', 'K'].includes(identity(sidc)))) return false
    if (filter === 'friend' && !(sidc && ['F', 'A'].includes(identity(sidc)))) return false
    if (filter === 'planned' && !(sidc && status(sidc) === 'A')) return false
    if (filter === 'units' && !(p.kind === 'symbol' && sidc && symbolKind(sidc) === 'unit')) return false
    if (filter === 'graphics' && !(p.kind === 'graphic' || p.kind === 'drawing')) return false
    if (filter === 'pictures' && !(p.kind === 'image' || p.kind === 'marker')) return false
  }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const { name, what } = featureLabelParts(feature)
  const text = [name, what, p.notes, ...Object.values(p.modifiers ?? {})].join(' ').toLowerCase()
  return words.every((w) => text.includes(w))
}

/** Layers by folder: folders (sorted) with their layers, then layers in no folder. */
export function byFolder(layers: UserLayer[]): [folder: string | null, layers: UserLayer[]][] {
  const folders = new Map<string, UserLayer[]>()
  const loose: UserLayer[] = []
  for (const layer of layers) {
    const folder = layer.style.folder?.trim()
    if (folder) folders.set(folder, [...(folders.get(folder) ?? []), layer])
    else loose.push(layer)
  }
  const out: [string | null, UserLayer[]][] = [...folders]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([f, l]): [string, UserLayer[]] => [f, l])
  if (loose.length) out.push([null, loose])
  return out
}

const FOLDED_KEY = 'oim-userlayers-folded'

function readFolded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

export interface OutlinerActions {
  update: () => void
  select: (feature: UserFeature, add: boolean) => void
  isSelected: (id: string) => boolean
  newLayer: () => void
}

export class Outliner {
  el: HTMLElement = el('.oim-ul-outliner')
  query = ''
  filters = new Set<Filter>()
  /** Layers showing their items. */
  expanded = new Set<string>()
  /** Folders folded to one line (remembered per browser). */
  folded = readFolded()
  /** Layers shown instead of the store's, read-only (a situation being viewed). */
  view: Map<string, UserLayer> | null = null
  private store: Store
  private actions: OutlinerActions
  private render?: (sidc: string, size?: number) => string
  private search: HTMLInputElement
  // Only these are drawn again; the search box stays (and keeps the focus).
  private chipsBox = el('div')
  private body = el('div')

  constructor(store: Store, actions: OutlinerActions) {
    this.store = store
    this.actions = actions
    this.search = el('input.oim-ul-outline-search', {
      type: 'search',
      placeholder: tt('userlayers.outline-search', 'Search your layers…'),
      'aria-label': tt('userlayers.outline-search', 'Search your layers…')
    }) as HTMLInputElement
    this.search.oninput = () => {
      this.query = this.search.value
      this.actions.update()
    }
    this.el.append(this.search, this.chipsBox, this.body)
  }

  private saveFolded() {
    try {
      localStorage.setItem(FOLDED_KEY, JSON.stringify([...this.folded]))
    } catch {
      // Not remembered.
    }
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

  /** A small picture of an item for the list. */
  private thumbnail(feature: UserFeature): HTMLElement {
    const p = feature.properties
    const span = el('span.oim-ul-thumb')
    if (p.kind === 'symbol' && p.sidc) {
      if (this.render) {
        try {
          span.innerHTML = this.render(p.sidc, 12)
        } catch {
          span.textContent = '⬚'
        }
      } else {
        span.textContent = '⬚'
        // The symbol library loads once; draw the list again then.
        void symbolRenderer().then((render) => {
          if (!this.render) {
            this.render = render
            this.actions.update()
          }
        })
      }
    } else if (p.kind === 'graphic') {
      span.textContent = GEOMETRY_LABELS[entryOf(p.sidc ?? '')?.[3] ?? 'L']?.[0] ?? '➚'
    } else if (p.kind === 'image' && p.image) {
      span.append(el('img', { src: imageUrl(p.image), alt: '' }))
    } else {
      span.textContent =
        { marker: '📍', drawing: feature.geometry.type === 'Polygon' ? '▱' : '╱', copy: '⧉' }[
          p.kind as string
        ] ?? '•'
    }
    return span
  }

  private item(feature: UserFeature, layer: UserLayer): HTMLElement {
    const { name, what, detail } = featureLabelParts(feature)
    const selected = this.actions.isSelected(feature.id)
    const row = el(
      `li.oim-ul-item${selected ? '.selected' : ''}`,
      {
        draggable: !layer.style.locked && !this.view,
        title: tt(
          'userlayers.item-title',
          'Click: select · Shift-click: select several · drag onto a layer: move'
        )
      },
      this.thumbnail(feature),
      el(
        'span.oim-ul-item-text',
        el('span.oim-ul-item-name', name || what),
        el('small', name ? [what, detail].filter(Boolean).join(' · ') : detail)
      )
    )
    // Shift or Ctrl / Cmd-click: add to the selection.
    row.onclick = (e) => this.actions.select(feature, e.shiftKey || e.ctrlKey || e.metaKey)
    row.ondragstart = (e) => {
      e.dataTransfer?.setData('application/x-oim-item', feature.id)
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
    }
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

  private layerRow(layer: UserLayer, items: UserFeature[], searching: boolean): HTMLElement {
    const store = this.store
    const hidden = store.hidden.has(layer.id)
    const locked = Boolean(layer.style.locked)
    const open = searching || this.expanded.has(layer.id)
    const active = layer.id === store.activeLayer
    const color = el('input.oim-ul-color', {
      type: 'color',
      value: layer.style.color ?? DEFAULT_COLOR,
      title: tt('userlayers.layer-color', 'Colour of its drawings and markers')
    }) as HTMLInputElement
    color.onclick = (e) => e.stopPropagation()
    color.onchange = () => store.updateLayer(layer.id, { style: { ...layer.style, color: color.value } })
    const folderNames = [
      ...new Set([...store.layers.values()].map((l) => l.style.folder).filter(Boolean))
    ] as string[]
    const menu = el(
      'details.oim-ul-menu',
      el('summary', '⋯', { title: tt('userlayers.more', 'More') }),
      el(
        '.oim-ul-menu-items',
        this.button(
          tt('userlayers.draw-here', 'Draw into this layer'),
          () => store.setActive(layer.id),
          '',
          'oim-ul-menu-text'
        ),
        this.button(
          tt('userlayers.rename', 'Rename'),
          () => {
            const value = window.prompt(tt('userlayers.rename', 'Rename'), layer.name)
            if (value && value.trim() && value.trim() !== layer.name)
              store.updateLayer(layer.id, { name: value.trim() })
          },
          '',
          'oim-ul-menu-text'
        ),
        this.button(
          tt('userlayers.move-to-folder', 'Move to folder…'),
          () => {
            const hint = folderNames.length ? ` (${folderNames.join(', ')})` : ''
            const value = window.prompt(
              tt('userlayers.folder-name', 'Folder name{{hint}}; empty: no folder', { hint }),
              layer.style.folder ?? ''
            )
            if (value !== null)
              store.updateLayer(layer.id, { style: { ...layer.style, folder: value.trim() || undefined } })
          },
          '',
          'oim-ul-menu-text'
        ),
        this.button(
          tt('userlayers.delete', 'Delete'),
          () => {
            const message = tt(
              'userlayers.delete-layer',
              'Delete the layer "{{name}}" and its {{count}} item(s)?',
              {
                name: layer.name,
                count: layer.features.size
              }
            )
            if (window.confirm(message)) store.deleteLayer(layer.id)
          },
          '',
          'oim-ul-menu-text'
        )
      )
    )
    const header = el(
      `.oim-ul-layer-row${active ? '.active' : ''}`,
      { draggable: !this.view },
      this.button(
        hidden ? '◌' : '◉',
        () => store.setHidden(layer.id, !hidden),
        hidden ? tt('userlayers.show', 'Show on the map') : tt('userlayers.hide', 'Hide from the map')
      ),
      this.button(
        locked ? '🔒' : '🔓',
        () => store.updateLayer(layer.id, { style: { ...layer.style, locked: !locked || undefined } }),
        locked
          ? tt('userlayers.unlock', 'Locked: click to allow changes')
          : tt('userlayers.lock', 'Lock: no changes to its items'),
        locked ? 'oim-ul-locked' : 'oim-ul-unlocked'
      ),
      color,
      el('span.oim-ul-layer-label', `${open ? '▾' : '▸'} ${layer.name}`),
      active ? el('span.oim-ul-active-tag', tt('userlayers.active', 'drawing here')) : '',
      el(
        'span.oim-ul-count-badge',
        searching ? `${items.length}/${layer.features.size}` : String(layer.features.size)
      ),
      menu
    )
    header.onclick = () => {
      if (this.expanded.has(layer.id)) this.expanded.delete(layer.id)
      else this.expanded.add(layer.id)
      this.actions.update()
    }
    header.ondragstart = (e) => {
      if ((e.target as HTMLElement).closest('.oim-ul-item')) return
      e.dataTransfer?.setData('application/x-oim-layer', layer.id)
    }
    this.dropTarget(header, (id) => {
      const from = store.layerOf(id)
      if (from && from.id !== layer.id && !from.style.locked && !locked) store.moveFeature(id, layer.id)
    })
    const li = el(`li.oim-ul-layer${hidden ? '.hidden' : ''}`, header)
    if (open) {
      li.append(
        el(
          'ul.oim-ul-items',
          items.length
            ? items.map((f) => this.item(f, layer))
            : el(
                'li.oim-ul-hint',
                searching
                  ? tt('userlayers.no-match', 'Nothing matches.')
                  : tt('userlayers.empty-layer', 'Nothing in it yet.')
              )
        )
      )
    }
    return li
  }

  private folderRow(folder: string, layers: UserLayer[], body: HTMLElement[]): HTMLElement {
    const store = this.store
    const folded = this.folded.has(folder)
    const allHidden = layers.every((l) => store.hidden.has(l.id))
    const allLocked = layers.every((l) => l.style.locked)
    const header = el(
      '.oim-ul-folder-row',
      this.button(
        allHidden ? '◌' : '◉',
        () => layers.forEach((l) => store.setHidden(l.id, !allHidden)),
        tt('userlayers.folder-eye', 'Show or hide all its layers')
      ),
      this.button(
        allLocked ? '🔒' : '🔓',
        () =>
          layers.forEach((l) =>
            store.updateLayer(l.id, { style: { ...l.style, locked: !allLocked || undefined } })
          ),
        tt('userlayers.folder-lock', 'Lock or unlock all its layers'),
        allLocked ? 'oim-ul-locked' : 'oim-ul-unlocked'
      ),
      el('span.oim-ul-folder-label', `${folded ? '▸' : '▾'} 📁 ${folder}`),
      el('span.oim-ul-count-badge', tt('userlayers.n-layers', '{{count}} layers', { count: layers.length })),
      this.button(
        '✎',
        () => {
          const value = window.prompt(
            tt('userlayers.rename-folder', 'Rename the folder (empty: take its layers out)'),
            folder
          )
          if (value === null) return
          for (const l of layers)
            store.updateLayer(l.id, { style: { ...l.style, folder: value.trim() || undefined } })
        },
        tt('userlayers.rename-folder-title', 'Rename the folder')
      )
    )
    header.onclick = () => {
      if (folded) this.folded.delete(folder)
      else this.folded.add(folder)
      this.saveFolded()
      this.actions.update()
    }
    // Drop a layer here to put it in the folder.
    this.dropTarget(header, undefined, (id) => {
      const layer = store.layers.get(id)
      if (layer && layer.style.folder !== folder) store.updateLayer(id, { style: { ...layer.style, folder } })
    })
    return el('li.oim-ul-folder', header, folded ? '' : el('ul.oim-ul-layers', body))
  }

  /** The whole list, drawn again from the store. */
  draw(): HTMLElement {
    const store = this.store
    const searching = Boolean(this.query.trim()) || this.filters.size > 0
    const chips = el(
      '.oim-ul-chips.oim-ul-filters',
      FILTERS.map(([filter, label]) => {
        const on = this.filters.has(filter)
        const b = el(`button.oim-ul-chip${on ? '.active' : ''}`, tt(`userlayers.filter.${filter}`, label), {
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
    const tree = el(`ul.oim-ul-tree${this.view ? '.oim-ul-readonly' : ''}`)
    for (const [folder, layers] of byFolder([...(this.view ?? store.layers).values()])) {
      const rows: HTMLElement[] = []
      for (const layer of layers) {
        const items = [...layer.features.values()].filter((f) => matches(f, this.query, this.filters))
        if (searching && !items.length) continue
        rows.push(this.layerRow(layer, items, searching))
      }
      if (!rows.length) continue
      if (folder) tree.append(this.folderRow(folder, layers, rows))
      else rows.forEach((r) => tree.append(r))
    }
    // Drop a layer on the empty space below the tree: out of its folder.
    const loose = el(
      'li.oim-ul-drop-out',
      tt('userlayers.drop-out', 'Drop a layer here to take it out of its folder')
    )
    this.dropTarget(loose, undefined, (id) => {
      const layer = store.layers.get(id)
      if (layer?.style.folder) store.updateLayer(id, { style: { ...layer.style, folder: undefined } })
    })
    if ([...store.layers.values()].some((l) => l.style.folder)) tree.append(loose)
    const create = el('button.oim-ul-button', `+ ${tt('userlayers.new-layer', 'New layer')}`, {
      type: 'button'
    })
    create.onclick = () => this.actions.newLayer()
    this.chipsBox.replaceChildren(chips)
    this.body.replaceChildren(
      store.layers.size
        ? searching && !tree.childElementCount
          ? el('p.oim-ul-hint', tt('userlayers.no-match', 'Nothing matches.'))
          : tree
        : el(
            'p.oim-ul-hint',
            tt(
              'userlayers.no-layers',
              'No layer yet: pick a tool in the toolbar above the map, a layer is made for you.'
            )
          ),
      el('.oim-ul-row', create)
    )
    return this.el
  }
}
