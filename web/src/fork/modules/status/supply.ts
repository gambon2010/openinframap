// Fork: power supply mode (backend: web-backend/src/fork/grid_supply.py). While on,
// upstream's power lines, substations and plants are recoloured (nothing is drawn
// over them): green, red where the statuses leave them without supply, orange with
// less (fed only through lower voltages), grey where they aren't connected to any
// source in the data. Each circuit of a way carrying several gets its own colour.
// Copies in My layers too (ui/supply.ts). A banner sums it up.
import { Map } from 'maplibre-gl'
import { el, setChildren } from 'redom'
import { t } from '../../core/i18n.ts'
import { BACKEND_BASE_URL } from '../../config.ts'
import { SUPPLY_COLOURS, Supply, supplyColours } from '../../ui/supply.ts'

const GREY = '#9e9e9e'

/** Per id: a line's circuits ({s1: "red"}) or a station ("red"). */
interface States {
  lines: Record<string, Record<string, string>>
  stations: Record<string, string>
}

interface SupplyResult extends States {
  lost: number
  counts: Record<'red' | 'orange', Record<string, number>>
  features: Record<string, Supply>
}

// Upstream's layers recoloured while the mode is on, by the feature state their
// features get (the backend says which ids aren't green): a line's circuit k
// (power_line_k draws a way's k-th voltage) from "sk", a station from "station".
// Lines below 10 kV aren't in the grid network: grey.
const LINE_LAYERS = [1, 2, 3].flatMap((k) =>
  [`power_line_${k}`, `power_line_underground_${k}`].map((id) => ({
    id,
    property: 'line-color' as const,
    state: `s${k}`,
    voltage: k === 1 ? 'voltage' : `voltage_${k}`
  }))
)
const STATION_LAYERS = [
  { id: 'power_substation', property: 'fill-color' as const },
  { id: 'power_substation_point', property: 'circle-color' as const },
  { id: 'power_plant', property: 'fill-color' as const }
]
// The tile layers whose features get states (a station's area and point have the same id).
const STATE_LAYERS = [
  'power_line',
  'power_substation',
  'power_substation_point',
  'power_plant',
  'power_plant_point'
]

/** A colour from a feature state ("red", "orange", "grey"), else `otherwise`. */
export function stateColour(state: string, otherwise: unknown): unknown {
  return [
    'match',
    ['coalesce', ['feature-state', state], ''],
    'red',
    SUPPLY_COLOURS.red,
    'orange',
    SUPPLY_COLOURS.orange,
    'grey',
    GREY,
    otherwise
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
  // What no source reaches anyway (GET /grid/supply/unconnected): fetched once.
  private grey: States | null = null
  // The paint each recoloured layer had, put back when the mode is turned off.
  private original = new globalThis.Map<string, unknown>()
  private listeners: (() => void)[] = []
  banner: HTMLElement = el('div.oim-supply-banner')

  constructor(private map: Map) {
    map.getContainer().append(this.banner)
    // A new style (another background map) has upstream's paint and no states again.
    map.on('style.load', () => {
      this.original.clear()
      this.draw()
    })
  }

  onChange(listener: () => void) {
    this.listeners.push(listener)
  }

  async set(active: boolean, pessimistic = this.pessimistic) {
    this.active = active
    this.pessimistic = pessimistic
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
      const [result, grey] = await Promise.all([
        fetch(`${BACKEND_BASE_URL}/grid/supply?pessimistic=${this.pessimistic ? 1 : 0}`).then((r) => {
          if (!r.ok) throw new Error(r.statusText)
          return r.json()
        }),
        this.grey ?? fetch(`${BACKEND_BASE_URL}/grid/supply/unconnected`).then((r) => r.json())
      ])
      this.result = result
      this.grey = grey
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

  private recolour(on: boolean) {
    const layers = [
      ...LINE_LAYERS.map((l) => ({
        ...l,
        colour: stateColour(l.state, [
          'case',
          ['>=', ['to-number', ['get', l.voltage], 0], 10],
          SUPPLY_COLOURS.green,
          GREY
        ])
      })),
      ...STATION_LAYERS.map((l) => ({ ...l, colour: stateColour('station', SUPPLY_COLOURS.green) }))
    ]
    for (const { id, property, colour } of layers) {
      if (!this.map.getLayer(id)) continue
      if (!this.original.has(id)) this.original.set(id, this.map.getPaintProperty(id, property))
      this.map.setPaintProperty(id, property, (on ? colour : this.original.get(id)) as never)
    }
  }

  private applyStates(on: boolean) {
    for (const sourceLayer of STATE_LAYERS) {
      this.map.removeFeatureState({ source: 'power', sourceLayer })
    }
    if (!on) return
    // Grey first: what lost its supply is coloured over it.
    for (const states of [this.grey, this.result]) {
      if (!states) continue
      for (const [id, circuits] of Object.entries(states.lines)) {
        this.map.setFeatureState({ source: 'power', sourceLayer: 'power_line', id: Number(id) }, circuits)
      }
      for (const [key, state] of Object.entries(states.stations)) {
        const [layer, id] = key.split(':')
        for (const sourceLayer of [layer, `${layer}_point`]) {
          this.map.setFeatureState({ source: 'power', sourceLayer, id: Number(id) }, { station: state })
        }
      }
    }
  }

  private draw() {
    const on = this.active && this.result !== null
    if (!this.map.getSource('power')) return
    this.recolour(on)
    this.applyStates(on)
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
