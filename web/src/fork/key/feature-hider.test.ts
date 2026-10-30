import { describe, expect, test } from 'vitest'
import { Map as MapLibreMap } from 'maplibre-gl'
import { FeatureHider, specKey } from './feature-hider.ts'

// Enough of a map for the hider's constructor; conditions() only reads the layers given.
const fakeMap = { on: () => undefined } as unknown as MapLibreMap

const layers = [
  {
    id: 'power_line_1',
    type: 'line',
    source: 'power',
    'source-layer': 'power_line',
    paint: { 'line-color': ['match', ['get', 'voltage'], 380, '#b54eb2', 220, '#c73030', '#7a7a85'] }
  },
  {
    id: 'power_line_case',
    type: 'line',
    source: 'power',
    'source-layer': 'power_line',
    paint: { 'line-color': '#fff' }
  },
  { id: 'power_line_label', type: 'symbol', source: 'power', 'source-layer': 'power_line', layout: {} },
  {
    id: 'telecoms_line',
    type: 'line',
    source: 'telecoms',
    'source-layer': 'telecoms_line',
    paint: { 'line-color': '#61637a' }
  },
  {
    id: 'power_plant_symbol',
    type: 'symbol',
    source: 'power',
    'source-layer': 'power_plant_point',
    layout: { 'icon-image': ['match', ['get', 'source'], 'coal', 'power_plant_coal', 'power_plant'] }
  }
]

describe('FeatureHider.conditions', () => {
  const hider = new FeatureHider(fakeMap)

  test('a colour: the layer drawing it and the other layers of the same data', () => {
    const conditions = hider.conditions({ colour: '#c73030' }, layers)
    expect([...conditions.keys()].sort()).toEqual(['power_line_1', 'power_line_case', 'power_line_label'])
    // Not other data drawn from another source-layer.
    expect(conditions.has('telecoms_line')).toBe(false)
  })

  test('layers by prefix are hidden outright', () => {
    const conditions = hider.conditions({ layers: ['telecoms_'] }, layers)
    expect([...conditions.entries()]).toEqual([['telecoms_line', false]])
  })

  test('an icon only affects symbol layers showing it', () => {
    const conditions = hider.conditions({ icon: 'power_plant_coal' }, layers)
    expect(conditions.has('power_plant_symbol')).toBe(true)
    expect(conditions.has('power_line_1')).toBe(false)
  })

  test('hidden rows are remembered by their spec', () => {
    localStorage.clear()
    const h = new FeatureHider(fakeMap)
    h.apply = () => undefined // no map to apply to
    h.setHidden({ colour: '#c73030' }, true)
    expect(new FeatureHider(fakeMap).hidden.has(specKey({ colour: '#c73030' }))).toBe(true)
  })
})
