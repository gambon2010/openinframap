// Fork: power supply mode (supply.ts): its constants and tables.

export const GREY = '#9e9e9e'

// Upstream's layers recoloured while the mode is on, by the feature state their
// features get (the backend says which ids aren't green): a line's circuit k
// (power_line_k draws a way's k-th voltage) from "sk", a station from "station".
// Lines below 10 kV aren't in the grid network: grey.
export const LINE_LAYERS = [1, 2, 3].flatMap((k) =>
  [`power_line_${k}`, `power_line_underground_${k}`].map((id) => ({
    id,
    property: 'line-color' as const,
    state: `s${k}`,
    voltage: k === 1 ? 'voltage' : `voltage_${k}`
  }))
)

export const STATION_LAYERS = [
  { id: 'power_substation', property: 'fill-color' as const },
  { id: 'power_substation_point', property: 'circle-color' as const },
  { id: 'power_plant', property: 'fill-color' as const }
]

// The tile layers whose features get states (a station's area and point have the same id).
export const STATE_LAYERS = [
  'power_line',
  'power_substation',
  'power_substation_point',
  'power_plant',
  'power_plant_point'
]
