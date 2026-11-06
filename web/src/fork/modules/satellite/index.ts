// Fork: offline satellite imagery as the background (scripts/satellite.py, chosen in
// scripts/build-region.sh or scripts/satellite.sh). Each file (NASA Blue Marble for
// the world to zoom 8, Sentinel-2 10 m for an area or the world, aerial photos by
// country) is a raster source served by the `basemap` service; the scripts write
// them to VITE_SATELLITE_TIERS. Settings → Background chooses:
//   map        the usual background map
//   satellite  imagery instead of it (place names and infrastructure on top)
//   hybrid     imagery with the background map's roads, railways and boundaries
import { t } from '../../core/i18n.ts'
import { Map, SourceSpecification } from 'maplibre-gl'
import { el } from 'redom'
import { ForkModule } from '../../types.ts'
import { LayerSpecificationWithZIndex } from '../../../style/types.ts'
import { addSettingsSection } from '../../ui/settings.ts'
import './satellite.css'

export interface Tier {
  url: string
  minzoom: number
  maxzoom: number
  /** Its credit line (from scripts/satellite.py, written with the tier). */
  attribution: string
}

import { throughGate } from '../../config.ts'
import { readText, writeText } from '../../core/storage.ts'
import { MapColours, mapColours } from '../../services/map-colours.ts'

export type BackgroundMode = 'map' | 'satellite' | 'hybrid'

const MODE_KEY = 'oim-background-mode'

/** "URL MIN MAX|CREDIT;..." (VITE_SATELLITE_TIERS) -> tiers, coarsest first. */
export function parseTiers(value: string | undefined): Tier[] {
  if (!value) return []
  const tiers: Tier[] = []
  for (const part of value.split(';')) {
    const [tier, attribution = ''] = part.split('|')
    const [url, min, max] = tier.trim().split(/\s+/)
    const minzoom = Number(min)
    const maxzoom = Number(max)
    if (
      url &&
      url.includes('{z}') &&
      Number.isInteger(minzoom) &&
      Number.isInteger(maxzoom) &&
      minzoom <= maxzoom
    ) {
      tiers.push({ url: throughGate(url), minzoom, maxzoom, attribution: attribution.trim() })
    }
  }
  return tiers.sort((a, b) => a.minzoom - b.minzoom)
}

const TIERS = parseTiers(import.meta.env.VITE_SATELLITE_TIERS)

type Bounds = [west: number, south: number, east: number, north: number]

/** The address of a tier's TileJSON (the background map server's /<name>.json), with its bounds. */
export function tileJsonUrl(tileUrl: string): string {
  return tileUrl.replace(/\/\{z\}.*$/, '.json')
}

/** Whether any of the imagery's bounds overlap the view. */
export function covers(imagery: Bounds[], view: Bounds): boolean {
  return imagery.some(([w, s, e, n]) => w < view[2] && e > view[0] && s < view[3] && n > view[1])
}

// What the imagery covers, read once; null if it can't be told (then it's offered everywhere).
let coverage: Promise<Bounds[] | null> | undefined
function imageryBounds(): Promise<Bounds[] | null> {
  coverage ??= Promise.all(
    TIERS.map((tier) =>
      fetch(tileJsonUrl(tier.url))
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => (Array.isArray(json?.bounds) ? (json.bounds as Bounds) : null))
    )
  )
    .then((bounds) => (bounds.every((b) => b) ? (bounds as Bounds[]) : null))
    .catch(() => null)
  return coverage
}

const sourceId = (i: number) => `satellite_${i}`

/** Background map layers drawn above the imagery in hybrid mode (the rest is hidden by it). */
export function isHybridOverlay(layerId: string): boolean {
  return /^osm_(roads|rail|runway|taxiway)|^boundaries/.test(layerId)
}

function readMode(): BackgroundMode {
  const value = readText(MODE_KEY)
  return value === 'satellite' || value === 'hybrid' ? value : 'map'
}

function storeMode(mode: BackgroundMode) {
  writeText(MODE_KEY, mode)
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
          attribution: tier.attribution
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

    // The map in its two colourings (services/map-colours.ts), then the imagery.
    type Choice = 'original' | 'contrast' | 'satellite' | 'hybrid'
    const mapChoices: [Choice, string, string][] = [
      [
        'contrast',
        t('satellite.map-contrast', 'Map, high contrast'),
        t('satellite.map-contrast-help', 'Each kind of area its own shade: towns, fields, woods, water')
      ],
      [
        'original',
        t('satellite.map-original', 'Map, original colours'),
        t('satellite.map-original-help', "Open Infrastructure Map's own, paler")
      ]
    ]
    const imageryChoices: [Choice, string, string][] = [
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
    const isMap = (value: string) => value === 'original' || value === 'contrast'
    const choices = [...mapChoices, ...(TIERS.length ? imageryChoices : [])]
    const radios = choices.map(([value, label, help]) => {
      const input = el('input', { type: 'radio', name: 'oim-background', value }) as HTMLInputElement
      input.onchange = () => {
        if (isMap(value)) mapColours.set(value as MapColours)
        mode = isMap(value) ? 'map' : (value as BackgroundMode)
        storeMode(mode)
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
      el('.oim-background-choices', ...radios.map((r) => r.row)),
      TIERS.length
        ? ''
        : el(
            'p.oim-map-sources-note',
            t(
              'satellite.none',
              'No satellite imagery yet. Run "bash scripts/satellite.sh" (your data stays): NASA Blue Marble for the whole world, Sentinel-2 10 m for your region, and in France IGN aerial photos.'
            )
          ),
      TIERS.length
        ? el(
            'p.oim-map-sources-note',
            t('satellite.zooms', 'Imagery up to zoom {{zoom}}.', {
              zoom: Math.max(...TIERS.map((tier) => tier.maxzoom))
            })
          )
        : ''
    )
    // No imagery where the map is: the satellite choices can't be picked.
    const nothingHere = el(
      'p.oim-map-sources-note',
      t('satellite.not-here', 'No satellite imagery here: move the map to where you have some.')
    )
    nothingHere.hidden = true
    section.append(nothingHere)
    const checkCoverage = async () => {
      const imagery = await imageryBounds()
      const b = map.getBounds()
      const here = !imagery || covers(imagery, [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
      for (const r of radios) {
        if (isMap(r.input.value)) continue
        r.input.disabled = !here
        r.row.classList.toggle('disabled', !here)
      }
      nothingHere.hidden = here
    }
    map.on('moveend', () => {
      if (section.isConnected) void checkCoverage()
    })
    addSettingsSection({
      el: section,
      refresh: () => {
        const chosen = mode === 'map' ? mapColours.get() : mode
        radios.forEach((r) => (r.input.checked = r.input.value === chosen))
        void checkCoverage()
      }
    })
  }
}

export default satellite
