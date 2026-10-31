// Fork: statuses of map features (docs/plans/feature-status.md, step 1): set in a
// feature's details (details.ts), shown on the map when they're a problem (map.ts),
// listed and played back on the Status board (board.ts), found by the search.
// Backend: web-backend/src/fork/userdata/status.py.
import { Layer, LayerGroup } from '@russss/maplibregl-layer-switcher'
import { el } from 'redom'
import { t } from '../../core/i18n.ts'
import { ForkModule } from '../../types.ts'
import { addDetailsExtra } from '../../ui/details.ts'
import { dock } from '../../ui/dock.ts'
import { onLive } from '../../ui/live.ts'
import { StatusBoard } from './board.ts'
import { SupplyMode } from './supply.ts'
import { StatusMap, badgeImage, statusLayers, statusSources } from './map.ts'
import { StatusSection, featureKey } from './details.ts'
import { canHaveStatus, fieldsOf } from './fields.ts'
import { SelectionPanel } from './selection.ts'
import { PROBLEMS, Status, statusLook } from './statuses.ts'
import './status.css'

function badgeSwatch(status: (typeof PROBLEMS)[number]): HTMLElement {
  const image = badgeImage(status)
  if (!image) return el('span')
  const canvas = el('canvas', { width: image.width, height: image.height }) as HTMLCanvasElement
  canvas.getContext('2d')?.putImageData(image, 0, 0)
  canvas.style.width = canvas.style.height = '18px'
  return canvas
}

const status: ForkModule = {
  sources: statusSources,
  layers: statusLayers,

  switcherGroups: () => [
    new LayerGroup(t('layers.status-group', 'Statuses'), [
      new Layer('K', t('layers.status', 'Damage and threats'), 'status_', true)
    ])
  ],

  init: (ctx) => {
    // The statuses are drawn over features: a click goes to the feature underneath.
    for (const layer of statusLayers()) delete ctx.clickRouter.handlers[layer.id]
    const statusMap = new StatusMap(ctx.map)
    const supply = new SupplyMode(ctx.map)
    const board = new StatusBoard(ctx.map, statusMap, supply)
    const load = () => {
      void statusMap.refresh()
      void supply.refresh()
      if (board.panel.classList.contains('visible')) void board.load()
    }
    // The board's button, with the others on the right; its panel in the dock.
    const button = el('button.maplibregl-ctrl-icon.oim-status-board-button', '⚠', {
      type: 'button',
      title: t('board.title', 'Status board'),
      'aria-label': t('board.title', 'Status board')
    })
    ctx.map.addControl(
      { onAdd: () => el('div.maplibregl-ctrl.maplibregl-ctrl-group', button), onRemove: () => {} },
      'top-right'
    )
    dock.add(button, board.panel, () => void board.load())
    // Someone set a status: the map, the supply and the board follow.
    onLive('status', load)
    if (ctx.map.isStyleLoaded()) load()
    else ctx.map.once('load', load)
    // Several at once: picked with Shift-click. MapLibre's Shift-drag box zoom would
    // take those clicks.
    ctx.map.boxZoom.disable()
    const startSelection = () => new SelectionPanel(ctx.map, load)
    if (ctx.map.isStyleLoaded()) startSelection()
    else ctx.map.once('load', startSelection)

    addDetailsExtra(async (feature, content) => {
      const key = featureKey(feature)
      if (!key || !canHaveStatus(feature.sourceLayer, feature.properties)) return
      const section = new StatusSection(
        key.layer,
        key.id,
        feature.properties['name'],
        fieldsOf(feature),
        load
      )
      if (!(await section.load()) || !content.isConnected) return
      content.insertBefore(section.el, content.querySelector('.oim-info-footer'))
    })
  },

  // A search result found by its status ("damaged": search.py search_statuses).
  searchDescription: (result) =>
    result.type === 'feature' && result.kind === 'status' && result.subtype
      ? t('status.search-result', 'Status: {{status}}', {
          status: statusLook(result.subtype as Status).label
        })
      : undefined,

  key: async () => [
    {
      title: t('layers.status', 'Damage and threats'),
      rows: PROBLEMS.map((s) => [statusLook(s).label, badgeSwatch(s)])
    }
  ]
}

export default status
