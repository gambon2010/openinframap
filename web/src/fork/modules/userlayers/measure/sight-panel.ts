// Fork: a line of sight's profile in a split screen, opened from its card
// (kinds/measure.ts): the chart large on the right half of the screen
// (sight-chart.ts), the map on the left showing the line, fitted to it (MapLibre's
// camera padding), and hovering the chart marks that spot on the map. Closing it
// gives the map back its whole width.
import type { GeoJSONSource, LngLatBoundsLike, Map } from 'maplibre-gl'
import { el, setChildren } from 'redom'
import { t } from '../../../core/i18n.ts'
import { formatDistance, type LngLat } from '../../../core/earth.ts'
import { makePanel } from '../../../ui/panel.ts'
import { sightChart } from './sight-chart.ts'
import { pointAlong, sightAnswer, type ProfilePoint, type SightResult, type SightSettings } from './sight.ts'
import { sightVerdict } from './sight-verdict.ts'
import './sight-panel.css'

const HOVER_SOURCE = 'oim-ul-sight-hover'
/** Room around the line when the map is fitted to it (pixels). */
const FIT_PADDING = 60

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
}

export async function openSightPanel(line: SightLine) {
  if (!map) return
  openPanel?.classList.remove('visible')
  const readout = el(
    '.oim-ul-sight-readout',
    t('userlayers.sight-hover-hint', 'Point at the chart to see the place on the map.')
  )
  const chartBox = el('.oim-ul-sight-chart-box', t('userlayers.sight-asking', 'Looking at the terrain…'))
  const verdict = el('strong.oim-ul-sight-verdict')
  const note = el('p.oim-ul-sight-note')
  const { panel } = makePanel('oim-ul-sight-panel', line.title, verdict, legend(), chartBox, readout, note)
  openPanel = panel
  document.body.append(panel)
  panel.classList.add('visible')
  showLine(map, line, panel)
  whenClosed(panel, () => leave(panel))
  const result = await sightAnswer(line.from, line.to, line.settings)
  if (!result || result.target_seen === null) {
    chartBox.textContent = t('userlayers.sight-unknown', 'No terrain here: no answer.')
    return
  }
  verdict.textContent = sightVerdict(result, line.settings)
  note.textContent = sightNote(result, line.settings)
  const length = result.profile[result.profile.length - 1]?.[0] || 1
  setChildren(chartBox, [
    sightChart(result, (point) => {
      readout.textContent = point ? describe(point) : ''
      showHover(point ? pointAlong(line.from, line.to, point[0], length) : null)
    })
  ])
}

/** How the chart's heights are made, and what stands on the ground in them. */
function sightNote(result: SightResult, settings: SightSettings): string {
  const curvature = t(
    'userlayers.sight-note-curvature',
    "Heights as seen from the eyes: the far ground is lowered for the Earth's curvature, less the light's bending."
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

/** What's under the pointer: how far, the ground's height, what stands there. */
function describe([distance, ground, seen, standing, kind]: ProfilePoint): string {
  const parts = [formatDistance(distance)]
  if (ground !== null)
    parts.push(t('userlayers.sight-ground-at', 'ground {{height}} m', { height: Math.round(ground) }))
  if (kind === 'building')
    parts.push(t('userlayers.sight-building-at', 'building {{height}} m', { height: Math.round(standing) }))
  if (kind === 'trees')
    parts.push(t('userlayers.sight-trees-at', 'trees {{height}} m', { height: Math.round(standing) }))
  parts.push(seen ? t('userlayers.sight-seen-here', 'seen') : t('userlayers.sight-hidden-here', 'hidden'))
  return parts.join(' · ')
}

/** The map on the screen's left half, fitted to the line. */
function showLine(m: Map, line: SightLine, panel: HTMLElement) {
  const width = panel.getBoundingClientRect().width
  m.setPadding({ top: 0, bottom: 0, left: 0, right: width })
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

function showHover(at: LngLat | null) {
  if (!map) return
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: at ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: at }, properties: {} }] : []
  }
  const source = map.getSource(HOVER_SOURCE) as GeoJSONSource | undefined
  if (source) {
    source.setData(data)
    return
  }
  map.addSource(HOVER_SOURCE, { type: 'geojson', data })
  map.addLayer({
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

/** The map back to its whole width, the hover mark gone. */
function leave(panel: HTMLElement) {
  panel.remove()
  if (openPanel === panel) openPanel = null
  if (!map) return
  if (map.getLayer(HOVER_SOURCE)) map.removeLayer(HOVER_SOURCE)
  if (map.getSource(HOVER_SOURCE)) map.removeSource(HOVER_SOURCE)
  map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 } })
}

function whenClosed(panel: HTMLElement, closed: () => void) {
  new MutationObserver((_, observer) => {
    if (panel.classList.contains('visible')) return
    observer.disconnect()
    closed()
  }).observe(panel, { attributes: true, attributeFilter: ['class'] })
}
