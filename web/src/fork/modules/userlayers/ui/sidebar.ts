// Fork: My layers' sidebar in the left column: the situation selector, the list of
// layers and items (outliner.ts) and the settings (labels on the map, the name
// changes are saved under). Built once, so the list's search box keeps its focus;
// each update refreshes the message and the list.
import { el } from 'redom'
import { t } from '../../../core/i18n.ts'
import { UserFeature } from '../model/model.ts'
import { Outliner } from './outliner.ts'
import { measurePrefs } from '../measure/prefs.ts'
import type { North } from '../measure/north.ts'
import { download, importFile } from '../io/files.ts'
import { getLabelLevel, setLabelLevel } from '../map/symbols.ts'
import { GraphicLabelChoice, graphicLabelChoice, setGraphicLabelChoice } from '../map/graphic-labels.ts'
import { LabelLevel } from '../model/fields.ts'
import type { Workspace } from './workspace.ts'

export class Sidebar {
  readonly el = el('.maplibregl-ctrl.oim-ul-sidebar')
  private outline = el('.oim-ul-outline')
  private message = el('div')
  readonly outliner: Outliner
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
      importFile: () => void importFile(ws.store, ws.map),
      zoomToLayer: (layer) => this.zoomToAll([...layer.features.values()]),
      // The map draws the layers in the list's order.
      reordered: () => void ws.renderer.render(ws.store.layers, ws.store.hidden)
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
    // The labels on tactical graphics (map/graphic-labels.ts): ours in English or
    // French, or the standard's.
    const graphicLabels = el(
      'select',
      (
        [
          ['en', t('userlayers.graphic-labels-en', 'English')],
          ['fr', 'Français'],
          ['standard', t('userlayers.graphic-labels-standard', 'Standard (MIL-STD-2525)')]
        ] as [GraphicLabelChoice, string][]
      ).map(([value, label]) => el('option', label, { value, selected: value === graphicLabelChoice() }))
    ) as HTMLSelectElement
    graphicLabels.onchange = () => {
      setGraphicLabelChoice(graphicLabels.value as GraphicLabelChoice)
      void renderer.render(store.layers, store.hidden)
    }
    // Bearings of measurements (measure/north.ts): true, magnetic (compass) or grid north.
    const north = el(
      'select',
      (
        [
          ['true', t('measure.north-true', 'True north')],
          ['magnetic', t('measure.north-magnetic', 'Magnetic north (compass)')],
          ['grid', t('measure.north-grid', 'Grid north (MGRS)')]
        ] as [North, string][]
      ).map(([value, label]) => el('option', label, { value, selected: value === measurePrefs.north }))
    ) as HTMLSelectElement
    north.onchange = () => measurePrefs.set({ north: north.value as North })
    // Loaded from your account later, or changed elsewhere.
    measurePrefs.onChange(() => (north.value = measurePrefs.north))
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
        el('summary', t('userlayers.settings-more', 'Labels, bearings, name')),
        el('label.oim-ul-field', el('span', t('userlayers.labels-on-map', 'Labels on the map')), level),
        el('label.oim-ul-field', el('span', t('userlayers.graphic-labels', 'Graphic labels')), graphicLabels),
        el('label.oim-ul-field', el('span', t('userlayers.bearings-from', 'Measured bearings from')), north),
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
    if (store.keepTrouble && store.pending.length) {
      this.message.append(
        el(
          'p.oim-ul-error',
          t(
            'userlayers.not-kept',
            "Your unsaved changes can't be kept in this browser ({{error}}): if the page is reloaded or closed before you Save, they're lost. Save now.",
            { error: store.keepTrouble }
          )
        )
      )
    }
    this.ws.situations.updateLine()
    this.outliner.draw()
  }

  /** Move the map to an item picked in the list. */
  private zoomTo(feature: UserFeature) {
    this.zoomToAll([feature])
  }

  /** Move the map to show items (one point: centred on it, not too close). */
  private zoomToAll(features: UserFeature[]) {
    const map = this.ws.map
    const coords: [number, number][] = []
    const add = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === 'number') coords.push(c as [number, number])
      else if (Array.isArray(c)) c.forEach(add)
    }
    for (const feature of features) add((feature.geometry as GeoJSON.Point).coordinates)
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
