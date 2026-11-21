// Fork: a line of sight's profile in a split screen, opened from its card
// (kinds/measure.ts): a bubble over the right half of the screen, clear of the
// toolbar and the map's buttons, with the line's settings and the chart
// (sight-chart.ts; beside it: sight-panel-content.ts). It follows its line: moved,
// its heights changed (here or undone), it asks again, a spinner showing meanwhile;
// deleted, it closes. The map on the left is fitted to the line (MapLibre's camera
// padding; the line is My layers' own drawing, hidden with its layer); hovering the
// chart marks that spot on the map. Closing it gives the map back its whole width.
import type { GeoJSONSource, LngLatBoundsLike, Map } from 'maplibre-gl'
import { el, setChildren } from 'redom'
import { t } from '../../../core/i18n.ts'
import type { LngLat } from '../../../core/earth.ts'
import { debugMode } from '../../../services/debug-mode.ts'
import { makePanel } from '../../../ui/panel.ts'
import type { UserFeature } from '../model/model.ts'
import { measurementOf } from './features.ts'
import { sightChart } from './sight-chart.ts'
import { debugSection, describe, legend, settingsForm, sightNote } from './sight-panel-content.ts'
import { pointAlong, sightAnswer, sightKey, sightSettingsOf, type SightSettings } from './sight.ts'
import { sightVerdict } from './sight-verdict.ts'
import './sight-panel.css'

const HOVER_SOURCE = 'oim-ul-sight-hover'
/** Room around the line when the map is fitted to it (pixels). */
const FIT_PADDING = 60

/** My layers' items, as the panel needs them to follow its line (index.ts). */
export interface SightItems {
  item(id: string): UserFeature | undefined
  onChange(listener: () => void): void
}

/** A line of sight as the panel shows it, from its item. */
interface SightLine {
  title: string
  from: LngLat
  to: LngLat
  settings: SightSettings
}

/** The open panel: its line's item, the line as last shown, the parts it fills. */
interface Shown {
  panel: HTMLElement
  itemId: string
  line: SightLine
  parts: Parts
}

interface Parts {
  verdict: HTMLElement
  showSettings: (settings: SightSettings) => void
  chartBox: HTMLElement
  readout: HTMLElement
  note: HTMLElement
  debug: HTMLElement
}

let map: Map | null = null
let items: SightItems | null = null
let shown: Shown | null = null

/** Given when My layers starts (index.ts): the map, and the items to follow. */
export function connectSightPanel(m: Map, sightItems: SightItems) {
  map = m
  items = sightItems
  sightItems.onChange(followLine)
}

/** Opens a line of sight's profile; `update` saves changed heights on its item. */
export function openSightPanel(itemId: string, update: (changes: Partial<SightSettings>) => void) {
  const item = items?.item(itemId)
  const line = item && sightLineOf(item)
  if (!map || !line) return
  const m = map
  shown?.panel.classList.remove('visible')
  const settings = settingsForm(update)
  const parts: Parts = {
    verdict: el('strong.oim-ul-sight-verdict'),
    showSettings: settings.show,
    chartBox: el('.oim-ul-sight-chart-box'),
    readout: el('.oim-ul-sight-readout'),
    note: el('p.oim-ul-sight-note'),
    debug: el('section.oim-ul-sight-debug')
  }
  const { panel } = makePanel(
    'oim-ul-sight-panel',
    line.title,
    parts.verdict,
    settings.form,
    legend(),
    parts.chartBox,
    parts.readout,
    parts.note,
    parts.debug
  )
  shown = { panel, itemId, line, parts }
  document.body.append(panel)
  panel.classList.add('visible')
  fitMapTo(m, line, panel)
  whenClosed(panel, () => leave(m, panel))
  void showAnswer(m, shown)
}

/** The line of sight an item is (null: not one, or not two points yet). */
function sightLineOf(item: UserFeature): SightLine | null {
  const m = measurementOf(item)
  if (!m || m.type !== 'sight' || m.points.length < 2) return null
  return {
    title: String(item.properties.name || t('userlayers.what.measure-sight', 'Line of sight')),
    from: m.points[0],
    to: m.points[m.points.length - 1],
    settings: sightSettingsOf(item.properties)
  }
}

/** After any change to My layers: the open panel's line as it is now, asked again if
 * its points or heights changed; closed if it's gone. */
function followLine() {
  if (!shown || !map) return
  const item = items?.item(shown.itemId)
  const line = item && sightLineOf(item)
  if (!line) {
    shown.panel.classList.remove('visible')
    return
  }
  const before = shown.line
  shown.line = line
  shown.panel.querySelector('.oim-panel-header h2')?.replaceChildren(line.title)
  if (keyOf(line) !== keyOf(before)) void showAnswer(map, shown)
}

function keyOf(line: SightLine): string {
  return sightKey(line.from, line.to, line.settings)
}

/** Asks for the line's answer as it is now and shows it; the last answer stays,
 * faded, under a spinner while asking. */
async function showAnswer(m: Map, panel: Shown) {
  const { line, parts } = panel
  parts.showSettings(line.settings)
  showAsking(parts)
  const result = await sightAnswer(line.from, line.to, line.settings)
  // Changed again while asking (dragged on, closed): only the newest answer shows.
  if (shown !== panel || keyOf(panel.line) !== keyOf(line)) return
  parts.chartBox.classList.remove('asking')
  if (!result || result.target_seen === null) {
    parts.verdict.textContent = ''
    parts.chartBox.textContent = t('userlayers.sight-unknown', 'No terrain here: no answer.')
    return
  }
  const debugging = debugMode.on
  const length = result.profile[result.profile.length - 1]?.[0] || 1
  parts.verdict.textContent = sightVerdict(result, line.settings)
  parts.note.textContent = sightNote(result, line.settings)
  parts.readout.textContent = t(
    'userlayers.sight-hover-hint',
    'Point at the chart to see the place on the map.'
  )
  setChildren(parts.chartBox, [
    sightChart(result, (point) => {
      parts.readout.textContent = point ? describe(point, result, debugging) : ''
      showHover(m, point ? pointAlong(line.from, line.to, point[0], length) : null)
    })
  ])
  setChildren(parts.debug, debugging ? debugSection(result, line.settings) : [])
}

function showAsking(parts: Parts) {
  parts.verdict.replaceChildren(
    el('span.oim-spinner', { 'aria-hidden': 'true' }),
    t('userlayers.sight-asking', 'Looking at the terrain…')
  )
  parts.chartBox.classList.add('asking')
  parts.readout.textContent = ''
}

/** The map beside the bubble, fitted to the line. */
function fitMapTo(m: Map, line: SightLine, panel: HTMLElement) {
  const covered = m.getContainer().getBoundingClientRect().right - panel.getBoundingClientRect().left
  m.setPadding({ top: 0, bottom: 0, left: 0, right: Math.max(0, covered) })
  const bounds: LngLatBoundsLike = [
    [Math.min(line.from[0], line.to[0]), Math.min(line.from[1], line.to[1])],
    [Math.max(line.from[0], line.to[0]), Math.max(line.from[1], line.to[1])]
  ]
  // Clear of the left column's panels too (My layers, this line's card).
  m.fitBounds(bounds, {
    padding: {
      top: FIT_PADDING,
      bottom: FIT_PADDING,
      right: FIT_PADDING,
      left: leftPanelsEdge(m) + FIT_PADDING
    }
  })
}

/** Where the left column's open panels end (pixels from the map's left edge). */
function leftPanelsEdge(m: Map): number {
  const column = m.getContainer().querySelector('.maplibregl-ctrl-top-left')
  if (!column) return 0
  const left = m.getContainer().getBoundingClientRect().left
  const edges = [...column.children]
    .filter(
      (child) => (child as HTMLElement).dataset.leftOrder !== undefined && (child as HTMLElement).offsetParent
    )
    .map((child) => child.getBoundingClientRect().right - left)
  return Math.max(0, ...edges)
}

/** The spot under the chart's pointer on the map (null: none). */
function showHover(m: Map, at: LngLat | null) {
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: at ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: at }, properties: {} }] : []
  }
  const source = m.getSource(HOVER_SOURCE) as GeoJSONSource | undefined
  if (source) {
    source.setData(data)
    return
  }
  m.addSource(HOVER_SOURCE, { type: 'geojson', data })
  m.addLayer({
    id: HOVER_SOURCE,
    type: 'circle',
    source: HOVER_SOURCE,
    paint: {
      'circle-radius': 8,
      'circle-color': '#fff',
      'circle-stroke-color': '#111',
      'circle-stroke-width': 3
    }
  })
}

/** The map back to its whole width, the hover mark gone (not when another line's
 * panel has replaced it: that one keeps the map). */
function leave(m: Map, panel: HTMLElement) {
  panel.remove()
  if (shown?.panel !== panel) return
  shown = null
  if (m.getLayer(HOVER_SOURCE)) m.removeLayer(HOVER_SOURCE)
  if (m.getSource(HOVER_SOURCE)) m.removeSource(HOVER_SOURCE)
  m.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 } })
}

function whenClosed(panel: HTMLElement, closed: () => void) {
  new MutationObserver((_, observer) => {
    if (panel.classList.contains('visible')) return
    observer.disconnect()
    closed()
  }).observe(panel, { attributes: true, attributeFilter: ['class'] })
}
