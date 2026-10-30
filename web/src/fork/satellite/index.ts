// Fork: offline satellite imagery as the background (scripts/satellite.py, chosen in
// scripts/build-region.sh). Each tier (NASA Blue Marble to zoom 8, Sentinel-2 10 m,
// IGN 20 cm in France) is a raster source served by the `basemap` service; the
// build writes them to VITE_SATELLITE_TIERS. Settings → Background chooses:
//   map        the usual background map
//   satellite  imagery instead of it (place names and infrastructure on top)
//   hybrid     imagery with the background map's roads, railways and boundaries
import { t } from 'i18next'
import { Map, SourceSpecification } from 'maplibre-gl'
import { el } from 'redom'
import { ForkModule } from '../types.ts'
import { LayerSpecificationWithZIndex } from '../../style/types.ts'
import { addSettingsSection } from '../ui/settings.ts'
import './satellite.css'

export interface Tier {
  url: string
  minzoom: number
  maxzoom: number
}

export type BackgroundMode = 'map' | 'satellite' | 'hybrid'

const MODE_KEY = 'oim-background-mode'

const ATTRIBUTION: [RegExp, string][] = [
  [/sat-overview/, 'NASA Blue Marble'],
  [/sat-regional/, 'Contains modified Copernicus Sentinel data (2021), ESA WorldCover (CC BY 4.0)'],
  [/sat-detailed/, '© IGN (Licence Ouverte)']
]

/** "URL MIN MAX;URL MIN MAX" (VITE_SATELLITE_TIERS) -> tiers, coarsest first. */
export function parseTiers(value: string | undefined): Tier[] {
  if (!value) return []
  const tiers: Tier[] = []
  for (const part of value.split(';')) {
    const [url, min, max] = part.trim().split(/\s+/)
    const minzoom = Number(min)
    const maxzoom = Number(max)
    if (
      url &&
      url.includes('{z}') &&
      Number.isInteger(minzoom) &&
      Number.isInteger(maxzoom) &&
      minzoom <= maxzoom
    ) {
      tiers.push({ url, minzoom, maxzoom })
    }
  }
  return tiers.sort((a, b) => a.minzoom - b.minzoom)
}

export function attributionFor(url: string): string {
  return ATTRIBUTION.find(([pattern]) => pattern.test(url))?.[1] ?? ''
}

const TIERS = parseTiers(import.meta.env.VITE_SATELLITE_TIERS)

const sourceId = (i: number) => `satellite_${i}`

/** Background map layers drawn above the imagery in hybrid mode (the rest is hidden by it). */
export function isHybridOverlay(layerId: string): boolean {
  return /^osm_(roads|rail|runway|taxiway)|^boundaries/.test(layerId)
}

function readMode(): BackgroundMode {
  try {
    const value = localStorage.getItem(MODE_KEY)
    if (value === 'satellite' || value === 'hybrid') return value
  } catch {
    // No storage: the default.
  }
  return 'map'
}

function storeMode(mode: BackgroundMode) {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    // Kept for this page.
  }
}

let mode: BackgroundMode = TIERS.length ? readMode() : 'map'

/** Show the imagery for a mode: its layers' visibility, and where they sit. */
function apply(map: Map) {
  if (!TIERS.length || !map.getLayer(sourceId(0))) return
  const visibility = mode === 'map' ? 'none' : 'visible'
  const layers = map.getStyle().layers ?? []
  // Satellite: above the whole background map (place names come later, from the
  // labels style). Hybrid: under its roads, railways and boundaries.
  const firstOverlay = layers.find((l) => isHybridOverlay(l.id))?.id
  const firstData = layers.find(
    (l) => !l.id.startsWith('osm_') && !l.id.startsWith('satellite_') && !l.id.startsWith('black_marble')
  )?.id
  const before = mode === 'hybrid' ? firstOverlay : firstData
  // Buildings would cover the imagery in hybrid mode.
  if (map.getLayer('osm_buildings'))
    map.setLayoutProperty('osm_buildings', 'visibility', mode === 'hybrid' ? 'none' : 'visible')
  TIERS.forEach((_, i) => {
    const id = sourceId(i)
    map.setLayoutProperty(id, 'visibility', visibility)
    if (before && before !== id) map.moveLayer(id, before)
  })
}

const satellite: ForkModule = {
  sources: () =>
    Object.fromEntries(
      TIERS.map((tier, i): [string, SourceSpecification] => [
        sourceId(i),
        {
          type: 'raster',
          tiles: [tier.url],
          tileSize: 256,
          minzoom: tier.minzoom,
          maxzoom: tier.maxzoom,
          attribution: attributionFor(tier.url)
        }
      ])
    ),

  // Lowest of the data layers, so right above the background map; apply() moves them.
  layers: () =>
    TIERS.map((tier, i): LayerSpecificationWithZIndex => ({
      zorder: 1,
      id: sourceId(i),
      type: 'raster',
      source: sourceId(i),
      // The coarsest tier has no minzoom, and none has a maxzoom: each is
      // stretched under the finer ones where they have nothing.
      ...(i > 0 ? { minzoom: tier.minzoom } : {}),
      layout: { visibility: mode === 'map' ? 'none' : 'visible' }
    })),

  init: ({ map }) => {
    map.on('style.load', () => apply(map))
    if (map.isStyleLoaded()) apply(map)
    else map.once('load', () => apply(map))

    const choices: [BackgroundMode, string, string][] = [
      ['map', t('satellite.map', 'Map'), t('satellite.map-help', 'The usual background map')],
      [
        'satellite',
        t('satellite.satellite', 'Satellite'),
        t('satellite.satellite-help', 'Imagery, with place names')
      ],
      [
        'hybrid',
        t('satellite.hybrid', 'Satellite with roads'),
        t('satellite.hybrid-help', 'Imagery with roads, railways and borders')
      ]
    ]
    const radios = choices.map(([value, label, help]) => {
      const input = el('input', { type: 'radio', name: 'oim-background', value }) as HTMLInputElement
      input.onchange = () => {
        mode = value
        storeMode(value)
        apply(map)
      }
      return {
        input,
        row: el('label.oim-background-choice', input, el('span', el('strong', label), el('small', help)))
      }
    })
    const section = el(
      'section.oim-background',
      el('h3', t('satellite.title', 'Background')),
      TIERS.length
        ? el('.oim-background-choices', ...radios.map((r) => r.row))
        : el(
            'p.oim-map-sources-note',
            t(
              'satellite.none',
              'No satellite imagery yet. Run "bash scripts/build-region.sh" and choose it when asked: NASA Blue Marble for the overview, Sentinel-2 10 m for your region, and in France IGN aerial photos.'
            )
          ),
      TIERS.length
        ? el(
            'p.oim-map-sources-note',
            t('satellite.zooms', 'Imagery up to zoom {{zoom}}.', { zoom: TIERS[TIERS.length - 1].maxzoom })
          )
        : ''
    )
    addSettingsSection({
      el: section,
      refresh: () => radios.forEach((r) => (r.input.checked = r.input.value === mode))
    })
  }
}

export default satellite
