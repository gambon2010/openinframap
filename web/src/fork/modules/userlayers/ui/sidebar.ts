// Fork: My layers' sidebar in the left column: the situation selector, the list of
// layers and items (outliner.ts) and the settings (labels on the map, the name
// changes are saved under). Built once, so the list's search box keeps its focus;
// each update refreshes the message and the list.
import { el } from 'redom'
import { t } from '../../../core/i18n.ts'
import { UserFeature } from '../model/model.ts'
import { Outliner } from './outliner.ts'
import { download, importFile } from '../io/files.ts'
import { getLabelLevel, setLabelLevel } from '../map/symbols.ts'
import { LabelLevel } from '../model/fields.ts'
import type { Workspace } from './workspace.ts'

export class Sidebar {
  readonly el = el('.maplibregl-ctrl.oim-ul-sidebar')
  private outline = el('.oim-ul-outline')
  private message = el('div')
  private outliner: Outliner
  private built = false
  private ws: Workspace

  constructor(ws: Workspace) {
    this.ws = ws
    this.outliner = new Outliner(ws.store, {
      update: () => ws.update(),
      select: (feature, add) => {
        if (ws.store.view.live) {
          if (add) ws.tools.toggle(feature.id)
          else ws.tools.select(feature.id)
        }
        if (!add) this.zoomTo(feature)
      },
      isSelected: (id) => ws.tools.selection().includes(id),
      newLayer: (folder) => ws.newLayer(folder),
      exportLayers: (layers, format) => download(layers, format),
      importFile: () => void importFile(ws.store, ws.map)
    })
  }

  private build() {
    const { store, renderer } = this.ws
    const close = el('button.oim-panel-button', '×', {
      type: 'button',
      title: t('userlayers.close', 'Close My layers'),
      'aria-label': t('userlayers.close', 'Close My layers')
    })
    close.onclick = () => this.ws.toggle(false)
    const level = el(
      'select',
      (
        [
          ['none', t('userlayers.labels.none', 'None')],
          ['name', t('userlayers.labels.name', 'Designation only')],
          ['all', t('userlayers.labels.all', 'All fields')]
        ] as [LabelLevel, string][]
      ).map(([value, label]) => el('option', label, { value, selected: value === getLabelLevel() }))
    ) as HTMLSelectElement
    level.onchange = () => {
      setLabelLevel(level.value as LabelLevel)
      void renderer.render(store.layers, store.hidden)
    }
    const author = el('input.oim-ul-author', {
      type: 'text',
      value: store.author,
      placeholder: t('userlayers.author', 'Your name')
    }) as HTMLInputElement
    author.onchange = () => (store.author = author.value.trim())
    this.outline.append(
      this.ws.situations.line,
      this.message,
      this.outliner.el,
      el(
        'details.oim-ul-settings',
        el('summary', t('userlayers.settings', 'Labels and name')),
        el('label.oim-ul-field', el('span', t('userlayers.labels-on-map', 'Labels on the map')), level),
        el('label.oim-ul-field', el('span', t('userlayers.author-label', 'Saved as')), author)
      )
    )
    this.el.append(
      el('.oim-panel-header', el('h2', t('userlayers.title', 'My layers')), close),
      this.outline,
      this.ws.toolbar.fileInput
    )
    this.built = true
  }

  update() {
    this.el.classList.toggle('visible', this.ws.isOpen)
    if (!this.ws.isOpen) return
    if (!this.built) this.build()
    const store = this.ws.store
    this.message.textContent = ''
    if (!store.loaded) {
      this.message.append(el('p.oim-ul-hint', t('userlayers.loading', 'Loading...')))
      return
    }
    if (store.error) {
      this.message.append(
        el(
          'p.oim-ul-error',
          t(
            'userlayers.error',
            "The backend can't be reached, so layers can't be loaded or saved: {{error}}",
            {
              error: store.error
            }
          )
        )
      )
    }
    this.ws.situations.updateLine()
    this.outliner.draw()
  }

  /** Move the map to an item picked in the list. */
  private zoomTo(feature: UserFeature) {
    const map = this.ws.map
    const coords: [number, number][] = []
    const add = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === 'number') coords.push(c as [number, number])
      else if (Array.isArray(c)) c.forEach(add)
    }
    add((feature.geometry as GeoJSON.Point).coordinates)
    if (!coords.length) return
    if (coords.length === 1) {
      map.easeTo({ center: coords[0], zoom: Math.max(map.getZoom(), 13) })
      return
    }
    const lons = coords.map((c) => c[0])
    const lats = coords.map((c) => c[1])
    map.fitBounds(
      [
        [Math.min(...lons), Math.min(...lats)],
        [Math.max(...lons), Math.max(...lats)]
      ],
      { padding: 80, maxZoom: 15 }
    )
  }
}
