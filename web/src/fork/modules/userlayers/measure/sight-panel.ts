// Fork: a line of sight's profile in a split screen, opened from its card
// (kinds/measure.ts): a bubble over the right half of the screen, clear of the
// toolbar and the map's buttons, with the line's settings, the chart
// (sight-chart.ts) and, with debug on, the answer checked against itself
// (sight-debug.ts). The map on the left shows the line, fitted to it (MapLibre's
// camera padding), drawn by the panel itself so it shows even in a hidden layer;
// hovering the chart marks that spot on the map. Closing it gives the map back its
// whole width.
import type { GeoJSONSource, LngLatBoundsLike, Map } from 'maplibre-gl'
import { el, setChildren } from 'redom'
import { t } from '../../../core/i18n.ts'
import { formatDistance, type LngLat } from '../../../core/earth.ts'
import { debugMode } from '../../../services/debug-mode.ts'
import { makePanel } from '../../../ui/panel.ts'
import { sightChart } from './sight-chart.ts'
import { checkSight, dropOf, ROUNDING } from './sight-debug.ts'
import {
  BLOCKED_COLOUR,
  CLEAR_COLOUR,
  lineHeightAt,
  pointAlong,
  sightAnswer,
  sightStretches,
  type ProfilePoint,
  type SightResult,
  type SightSettings
} from './sight.ts'
import { sightVerdict } from './sight-verdict.ts'
import './sight-panel.css'

const MAP_SOURCE = 'oim-ul-sight-panel'
const LINE_LAYER = 'oim-ul-sight-panel-line'
const HOVER_LAYER = 'oim-ul-sight-panel-hover'
/** Room around the line when the map is fitted to it (pixels). */
const FIT_PADDING = 60
/** The backend gives where the target is first hidden in whole metres. */
const BLOCKED_AT_ROUNDING = 1

/** The map, given when My layers starts (index.ts). */
let map: Map | null = null
let openPanel: HTMLElement | null = null

export function setSightMap(m: Map) {
  map = m
}

export interface SightLine {
  title: string
  from: LngLat
  to: LngLat
  settings: SightSettings
  /** Saves changed settings on the item (its card shows the new answer). */
  update: (changes: Partial<SightSettings>) => void
}

/** The parts of the panel an answer fills. */
interface Parts {
  verdict: HTMLElement
  chartBox: HTMLElement
  readout: HTMLElement
  note: HTMLElement
  debug: HTMLElement
}

export function openSightPanel(line: SightLine) {
  if (!map) return
  const m = map
  openPanel?.classList.remove('visible')
  const parts: Parts = {
    verdict: el('strong.oim-ul-sight-verdict'),
    chartBox: el('.oim-ul-sight-chart-box'),
    readout: el('.oim-ul-sight-readout'),
    note: el('p.oim-ul-sight-note'),
    debug: el('section.oim-ul-sight-debug')
  }
  const settings = settingsForm(line, () => void showAnswer(m, line, parts))
  const { panel } = makePanel(
    'oim-ul-sight-panel',
    line.title,
    parts.verdict,
    settings,
    legend(),
    parts.chartBox,
    parts.readout,
    parts.note,
    parts.debug
  )
  openPanel = panel
  document.body.append(panel)
  panel.classList.add('visible')
  fitMapTo(m, line, panel)
  whenClosed(panel, () => leave(m, panel))
  void showAnswer(m, line, parts)
}

/** Asks for the line's answer with its settings now, and shows it everywhere. */
async function showAnswer(m: Map, line: SightLine, parts: Parts) {
  parts.verdict.textContent = ''
  parts.chartBox.textContent = t('userlayers.sight-asking', 'Looking at the terrain…')
  parts.readout.textContent = ''
  parts.note.textContent = ''
  setChildren(parts.debug, [])
  const settings = line.settings
  const result = await sightAnswer(line.from, line.to, settings)
  // Settings changed while asking: the newer answer shows instead.
  if (settings !== line.settings) return
  if (!result || result.target_seen === null) {
    parts.chartBox.textContent = t('userlayers.sight-unknown', 'No terrain here: no answer.')
    drawOnMap(m, [], null)
    return
  }
  const debugging = debugMode.on
  const length = result.profile[result.profile.length - 1]?.[0] || 1
  const stretches = lineFeatures(line, result)
  parts.verdict.textContent = sightVerdict(result, settings)
  parts.note.textContent = sightNote(result, settings)
  parts.readout.textContent = t(
    'userlayers.sight-hover-hint',
    'Point at the chart to see the place on the map.'
  )
  setChildren(parts.chartBox, [
    sightChart(result, (point) => {
      parts.readout.textContent = point ? describe(point, result, debugging) : ''
      drawOnMap(m, stretches, point ? pointAlong(line.from, line.to, point[0], length) : null)
    })
  ])
  if (debugging) setChildren(parts.debug, debugSection(result, settings))
  drawOnMap(m, stretches, null)
}

/** The line's four heights, changed here: saved on the item, the answer asked again. */
function settingsForm(line: SightLine, changed: () => void): HTMLElement {
  const field = (label: string, name: keyof SightSettings) => {
    const input = el('input', {
      type: 'number',
      min: 0,
      step: 0.5,
      value: line.settings[name],
      'data-field': name
    }) as HTMLInputElement
    input.onchange = () => {
      const metres = Number(input.value)
      if (!Number.isFinite(metres) || metres < 0) return
      line.settings = { ...line.settings, [name]: metres }
      line.update({ [name]: metres })
      changed()
    }
    return el('label.oim-ul-sight-setting', el('span', label), input)
  }
  return el(
    '.oim-ul-sight-settings',
    field(t('userlayers.sight-observer', 'Eyes above the ground (m)'), 'observer'),
    field(t('userlayers.sight-target', 'Target above the ground (m)'), 'target'),
    field(t('userlayers.sight-trees', 'Trees (m)'), 'trees'),
    field(t('userlayers.sight-buildings', 'Buildings without a height (m)'), 'buildings')
  )
}

/** How the chart's heights are made, and what stands on the ground in them. */
function sightNote(result: SightResult, settings: SightSettings): string {
  const curvature = t(
    'userlayers.sight-note-level',
    "Heights above or below the line of sight, as seen from the eyes: the far ground bends away for the Earth's curvature, less the light's bending."
  )
  const standing = result.obstacles_counted
    ? t(
        'userlayers.sight-note-counted',
        "Buildings stand as tall as OpenStreetMap says ({{buildings}} m when it doesn't), woods {{trees}} m: in France the terrain is bare ground.",
        { buildings: settings.buildings, trees: settings.trees }
      )
    : t(
        'userlayers.sight-note-in-terrain',
        'Outside France the terrain holds trees and buildings itself: none added.'
      )
  return `${curvature} ${standing}`
}

function legend(): HTMLElement {
  const key = (className: string, label: string) => el('span.oim-ul-sight-key', el(`i.${className}`), label)
  return el(
    '.oim-ul-sight-legend',
    key('oim-ul-sight-key-clear', t('userlayers.sight-key-clear', 'line clear')),
    key('oim-ul-sight-key-blocked', t('userlayers.sight-key-blocked', 'line blocked')),
    key('oim-ul-sight-key-ground', t('userlayers.sight-key-ground', 'ground')),
    key('oim-ul-sight-key-building', t('userlayers.sight-key-building', 'buildings')),
    key('oim-ul-sight-key-trees', t('userlayers.sight-key-trees', 'trees'))
  )
}

/** What's under the pointer: how far, the ground's height, what stands there; with
 * debug on, the heights the answer used there too. */
function describe(point: ProfilePoint, result: SightResult, debugging: boolean): string {
  const [distance, ground, seen, standing, kind, apparent] = point
  const parts = [formatDistance(distance)]
  if (ground !== null)
    parts.push(t('userlayers.sight-ground-at', 'ground {{height}} m', { height: Math.round(ground) }))
  if (kind === 'building')
    parts.push(t('userlayers.sight-building-at', 'building {{height}} m', { height: Math.round(standing) }))
  if (kind === 'trees')
    parts.push(t('userlayers.sight-trees-at', 'trees {{height}} m', { height: Math.round(standing) }))
  parts.push(seen ? t('userlayers.sight-seen-here', 'seen') : t('userlayers.sight-hidden-here', 'hidden'))
  if (debugging) {
    const line = lineHeightAt(result, distance)
    const drop = dropOf(point)
    parts.push(
      `top seen ${metres(apparent)} · lowered ${metres(drop)} · line ${metres(line)} · above the line ${metres(
        apparent !== null && line !== null ? apparent - line : null
      )}`
    )
  }
  return parts.join(' · ')
}

/** The answer's numbers and its checks (debug on): raw, in the backend's words. */
function debugSection(result: SightResult, settings: SightSettings): HTMLElement[] {
  const check = checkSight(result)
  const flag = (ok: boolean) => (ok ? ' ✓' : ' ✗')
  const dropOk = check.worstDropError <= ROUNDING
  const marginOk =
    check.margin === null || result.margin === null || Math.abs(check.margin - result.margin) <= ROUNDING
  const blockOk =
    result.target_seen === true ||
    (check.firstAbove !== null &&
      result.blocked_at !== null &&
      Math.abs(check.firstAbove - result.blocked_at) <= BLOCKED_AT_ROUNDING)
  const rows: [string, string][] = [
    ['settings', JSON.stringify(settings)],
    ['eye, target_top', `${metres(result.eye)}, ${metres(result.target_top)}`],
    ['target_seen, blocked_by', `${result.target_seen}, ${result.blocked_by}`],
    [
      'blocked_at · first above the line',
      `${metres(result.blocked_at)} · ${metres(check.firstAbove)}${flag(blockOk)}`
    ],
    ['margin · from the profile', `${metres(result.margin)} · ${metres(check.margin)}${flag(marginOk)}`],
    [
      'curvature',
      `${result.curvature.coefficient.toFixed(5)} × d² / (2 × ${result.curvature.earth_radius} m)`
    ],
    ['lowered at the target · formula', `${metres(check.dropAtEnd)} · ${metres(check.dropAtEndExpected)}`],
    ['worst lowering error', `${check.worstDropError.toFixed(2)} m${flag(dropOk)}`],
    ['samples · spacing', `${check.samples} · ${check.spacing.toFixed(1)} m`],
    ['obstacles_counted', String(result.obstacles_counted)]
  ]
  const copy = el('button.oim-ul-button', t('userlayers.sight-copy', 'Copy the answer (JSON)'), {
    type: 'button'
  }) as HTMLButtonElement
  // The clipboard can be refused (not a secure page): the button says so.
  copy.onclick = () =>
    navigator.clipboard.writeText(JSON.stringify(result)).then(
      () => (copy.textContent = t('userlayers.sight-copied', 'Copied')),
      () => (copy.textContent = t('userlayers.sight-copy-failed', 'Copying refused by the browser'))
    )
  return [
    el('h4', t('debug.details', 'Debug info')),
    el(
      'table.item_info',
      rows.map(([key, value]) => el('tr', el('th', key), el('td', value)))
    ),
    copy
  ]
}

function metres(value: number | null): string {
  return value === null ? '–' : `${value.toFixed(1)} m`
}

/** The line in its colours, clear and blocked, for the panel's own map layer. */
function lineFeatures(line: SightLine, result: SightResult): GeoJSON.Feature[] {
  return sightStretches(line.from, line.to, result).map((stretch) => ({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: stretch.points },
    properties: { color: stretch.clear ? CLEAR_COLOUR : BLOCKED_COLOUR }
  }))
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

/** The panel's line on the map, and the spot under the chart's pointer. */
function drawOnMap(m: Map, stretches: GeoJSON.Feature[], hover: LngLat | null) {
  const hoverFeatures: GeoJSON.Feature[] = hover
    ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: hover }, properties: {} }]
    : []
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [...stretches, ...hoverFeatures]
  }
  const source = m.getSource(MAP_SOURCE) as GeoJSONSource | undefined
  if (source) {
    source.setData(data)
    return
  }
  m.addSource(MAP_SOURCE, { type: 'geojson', data })
  m.addLayer({
    id: LINE_LAYER,
    type: 'line',
    source: MAP_SOURCE,
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 4 }
  })
  m.addLayer({
    id: HOVER_LAYER,
    type: 'circle',
    source: MAP_SOURCE,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 8,
      'circle-color': '#fff',
      'circle-stroke-color': '#111',
      'circle-stroke-width': 3
    }
  })
}

/** The map back to its whole width, the panel's line and mark gone (not when another
 * line's panel has replaced it: that one keeps the map). */
function leave(m: Map, panel: HTMLElement) {
  panel.remove()
  if (openPanel !== panel) return
  openPanel = null
  for (const layer of [HOVER_LAYER, LINE_LAYER]) if (m.getLayer(layer)) m.removeLayer(layer)
  if (m.getSource(MAP_SOURCE)) m.removeSource(MAP_SOURCE)
  m.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 } })
}

function whenClosed(panel: HTMLElement, closed: () => void) {
  new MutationObserver((_, observer) => {
    if (panel.classList.contains('visible')) return
    observer.disconnect()
    closed()
  }).observe(panel, { attributes: true, attributeFilter: ['class'] })
}
