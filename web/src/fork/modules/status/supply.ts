// Fork: power supply mode (backend: web-backend/src/fork/grid_supply.py). While on,
// the power lines are green, and those the statuses leave without supply red, with
// less (fed only through lower voltages) orange; the same for substations and
// plants, and for their copies in My layers (ui/supply.ts). A banner sums it up.
import { GeoJSONSource, Map } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { el, setChildren } from 'redom'
import { t } from '../../core/i18n.ts'
import { BACKEND_BASE_URL } from '../../config.ts'
import { SUPPLY_COLOURS, Supply, supplyColours } from '../../ui/supply.ts'
import { LayerSpecificationWithZIndex } from '../../../style/types.ts'

const LINES = 'supply_lines'
const STATIONS = 'supply_stations'
// What no source reaches anyway (missing in OpenStreetMap), grey.
const UNCONNECTED = 'supply_unconnected'
const GREY = '#9e9e9e'
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
const LAYER_IDS = [
  'status_supply_base',
  'status_supply_unconnected',
  'status_supply_unconnected_stations',
  'status_supply_lines',
  'status_supply_stations'
]

interface SupplyResult {
  lost: number
  counts: Record<'red' | 'orange', Record<string, number>>
  stations: FeatureCollection
  lines: FeatureCollection
  features: Record<string, Supply>
}

const colour = [
  'match',
  ['get', 'supply'],
  'red',
  SUPPLY_COLOURS.red,
  'orange',
  SUPPLY_COLOURS.orange,
  SUPPLY_COLOURS.green
]

export function supplySources() {
  return {
    [LINES]: { type: 'geojson' as const, data: EMPTY },
    [STATIONS]: { type: 'geojson' as const, data: EMPTY },
    [UNCONNECTED]: { type: 'geojson' as const, data: EMPTY }
  }
}

/** Hidden until the mode is on. Above the power lines, below the statuses (280). */
export function supplyLayers(): LayerSpecificationWithZIndex[] {
  const hidden = { visibility: 'none' as const }
  return [
    {
      // Every power line of the network (10 kV and more) green: supplied as normal.
      zorder: 276,
      id: 'status_supply_base',
      type: 'line',
      source: 'power',
      'source-layer': 'power_line',
      filter: ['>=', ['to-number', ['get', 'voltage'], 0], 10],
      layout: { ...hidden, 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': SUPPLY_COLOURS.green,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 12, 2.5, 18, 5]
      }
    },
    {
      zorder: 276.5,
      id: 'status_supply_unconnected',
      type: 'line',
      source: UNCONNECTED,
      filter: ['!', ['has', 'station']],
      layout: { ...hidden, 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': GREY,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.5, 12, 3, 18, 6]
      }
    },
    {
      zorder: 276.6,
      id: 'status_supply_unconnected_stations',
      type: 'circle',
      source: UNCONNECTED,
      filter: ['has', 'station'],
      minzoom: 9,
      layout: hidden,
      paint: {
        'circle-color': GREY,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 14, 6],
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 1
      }
    },
    {
      zorder: 277,
      id: 'status_supply_lines',
      type: 'line',
      source: LINES,
      layout: { ...hidden, 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': colour as never,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2, 12, 4, 18, 7]
      }
    },
    {
      zorder: 278,
      id: 'status_supply_stations',
      type: 'circle',
      source: STATIONS,
      layout: hidden,
      paint: {
        'circle-color': colour as never,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 12, 9, 16, 14],
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 2
      }
    }
  ]
}

/** "2 × 400 kV, 2 × 63 kV" */
function byVoltage(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([kv, n]) => `${n} × ${kv} kV`)
    .join(', ')
}

export function supplySummary(result: Pick<SupplyResult, 'counts' | 'lost'>): string {
  const red = byVoltage(result.counts.red)
  const orange = Object.values(result.counts.orange).reduce((a, b) => a + b, 0)
  if (!result.lost) return t('supply.nothing-lost', 'No damaged or destroyed part of the grid: all supplied.')
  if (!red && !orange) return t('supply.all-supplied', 'Every station still supplied.')
  return [
    red ? t('supply.red', 'Without supply: {{list}} substations or plants', { list: red }) : '',
    orange ? t('supply.orange', '{{count}} with less power', { count: orange }) : ''
  ]
    .filter(Boolean)
    .join('; ')
}

export class SupplyMode {
  active = false
  pessimistic = false
  private result: SupplyResult | null = null
  private listeners: (() => void)[] = []
  banner: HTMLElement = el('div.oim-supply-banner')

  constructor(private map: Map) {
    map.getContainer().append(this.banner)
    // A new style (another background map) starts with empty sources.
    map.on('style.load', () => {
      this.unconnectedLoaded = false
      if (this.active) void this.set(true)
      else this.draw()
    })
  }

  onChange(listener: () => void) {
    this.listeners.push(listener)
  }

  private unconnectedLoaded = false

  async set(active: boolean, pessimistic = this.pessimistic) {
    this.active = active
    this.pessimistic = pessimistic
    if (active && !this.unconnectedLoaded) {
      // Once: the same until the grid is rebuilt (a few MB for a country).
      this.unconnectedLoaded = true
      ;(this.map.getSource(UNCONNECTED) as GeoJSONSource | undefined)?.setData(
        `${BACKEND_BASE_URL}/grid/supply/unconnected`
      )
    }
    if (active) await this.refresh()
    else {
      this.result = null
      this.draw()
    }
  }

  /** Work it out again (the statuses changed). */
  async refresh() {
    if (!this.active) return
    setChildren(this.banner, [el('span', t('supply.working', 'Working out the power supply…'))])
    this.banner.classList.add('visible')
    try {
      const response = await fetch(`${BACKEND_BASE_URL}/grid/supply?pessimistic=${this.pessimistic ? 1 : 0}`)
      if (!response.ok) throw new Error(await response.text())
      this.result = await response.json()
    } catch {
      this.result = null
      setChildren(this.banner, [el('span', t('supply.failed', "The power supply couldn't be worked out."))])
      return
    }
    this.draw()
  }

  get summary(): string {
    return this.result ? supplySummary(this.result) : ''
  }

  private draw() {
    const on = this.active && this.result !== null
    for (const id of LAYER_IDS) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
    }
    ;(this.map.getSource(LINES) as GeoJSONSource | undefined)?.setData(this.result?.lines ?? EMPTY)
    ;(this.map.getSource(STATIONS) as GeoJSONSource | undefined)?.setData(this.result?.stations ?? EMPTY)
    supplyColours.set(on, this.result?.features ?? {})
    this.banner.classList.toggle('visible', on)
    if (on) {
      setChildren(this.banner, [
        el('strong', t('supply.title', 'Power supply')),
        el('span', this.summary),
        el(
          'span.oim-supply-legend',
          (
            [
              [SUPPLY_COLOURS.green, t('supply.green', 'supplied')],
              [SUPPLY_COLOURS.orange, t('supply.orange-key', 'less power')],
              [SUPPLY_COLOURS.red, t('supply.red-key', 'none')],
              [GREY, t('supply.grey', 'not connected in the data')]
            ] as [string, string][]
          ).map(([colour, label]) => el('span', el('i', { style: { background: colour } }), label))
        ),
        el('button.oim-button', t('supply.off', 'Turn off'), {
          type: 'button',
          onclick: () => void this.set(false)
        })
      ])
    }
    for (const listener of this.listeners) listener()
  }
}
