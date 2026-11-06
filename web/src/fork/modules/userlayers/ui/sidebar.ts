// Fork: My layers' sidebar in the left column: a header (the situation selector, ⚙:
// My layers' settings, in their own window, ×), the list of layers and items
// (outliner/), the only part that scrolls, and its buttons under it. Built once, so
// the list's search box keeps its focus; each update refreshes the message and the
// list. It's as tall as its content, up to the bottom of the left column.
import { el } from 'redom'
import { t } from '../../../core/i18n.ts'
import { UserFeature } from '../model/model.ts'
import { Outliner } from './outliner/index.ts'
import { makeModal } from '../../../ui/panel.ts'
import { preferencesSection } from './preferences.ts'
import { download, importFile } from '../io/files.ts'
import type { Workspace } from './workspace.ts'
import { positionsOf } from '../model/shapes.ts'

export class Sidebar {
  readonly el = el('.maplibregl-ctrl.oim-ul-sidebar')
  private outline = el('.oim-ul-outline')
  private message = el('div')
  readonly outliner: Outliner
  private built = false
  private ws: Workspace
  /** My layers' settings: their own window, opened with ⚙. */
  private preferences: { open: () => void }

  constructor(ws: Workspace) {
    this.ws = ws
    const section = preferencesSection(() => void ws.renderer.render(ws.store.layers, ws.store.hidden))
    const dialog = makeModal(t('userlayers.settings-title', 'My layers settings'), section.el)
    this.preferences = {
      open: () => {
        section.refresh?.()
        dialog.open()
      }
    }
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
    const close = el('button.oim-panel-button', '×', {
      type: 'button',
      title: t('userlayers.close', 'Close My layers'),
      'aria-label': t('userlayers.close', 'Close My layers')
    })
    close.onclick = () => this.ws.toggle(false)
    const settings = el('button.oim-panel-button.oim-ul-settings-button', '⚙', {
      type: 'button',
      title: t('userlayers.settings', 'My layers settings: colour, labels, bearings'),
      'aria-label': t('userlayers.settings', 'My layers settings: colour, labels, bearings')
    })
    settings.onclick = () => this.preferences.open()
    // The header, the list (the only part that scrolls) and the buttons under it.
    this.outline.append(this.message, this.outliner.el)
    this.el.append(
      el(
        '.oim-panel-header',
        el('h2', t('userlayers.title', 'My layers')),
        this.ws.situations.line,
        settings,
        close
      ),
      this.outline,
      this.outliner.footer,
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
    const coords = features.flatMap((feature) => positionsOf(feature.geometry))
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
