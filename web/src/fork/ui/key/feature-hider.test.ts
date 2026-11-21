import { describe, expect, test } from 'vitest'
import { Map as MapLibreMap } from 'maplibre-gl'
import { FeatureHider, SAME_FEATURES_AS, specKey } from './feature-hider.ts'

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

  test('a row of two icons keeps only what shows neither', () => {
    const icon = ['match', ['get', 'kind'], 'airfield', 'site_airfield', 'former', 'site_former', 'site_base']
    const sites = [{ id: 'sites_symbol', type: 'symbol', source: 'sites', layout: { 'icon-image': icon } }]
    const conditions = hider.conditions({ icon: ['site_airfield', 'site_former'] }, sites)
    expect(conditions.get('sites_symbol')).toEqual([
      'all',
      ['!=', icon, 'site_airfield'],
      ['!=', icon, 'site_former']
    ])
  })

  test('an icon hides the areas that say they are the same features', () => {
    const icon = ['match', ['get', 'kind'], 'military_range', 'site_military_range', 'site_military_area']
    const sites = [
      {
        id: 'sites_military',
        type: 'symbol',
        source: 'sites',
        'source-layer': 'sites_point',
        layout: { 'icon-image': icon }
      },
      {
        id: 'sites_area_military',
        type: 'fill',
        source: 'sites',
        'source-layer': 'sites_area',
        metadata: { [SAME_FEATURES_AS]: 'sites_point' }
      },
      { id: 'other_area', type: 'fill', source: 'sites', 'source-layer': 'sites_area' }
    ]
    const conditions = hider.conditions({ icon: 'site_military_range' }, sites)
    expect(conditions.get('sites_area_military')).toEqual(['!=', icon, 'site_military_range'])
    // An area layer that doesn't say so is other data.
    expect(conditions.has('other_area')).toBe(false)
  })

  test('hidden rows are remembered by their spec', () => {
    localStorage.clear()
    const h = new FeatureHider(fakeMap)
    h.apply = () => undefined // no map to apply to
    h.setHidden({ colour: '#c73030' }, true)
    expect(new FeatureHider(fakeMap).hidden.has(specKey({ colour: '#c73030' }))).toBe(true)
  })

  test('a row hidden at first is hidden once, then left as the user sets it', () => {
    localStorage.clear()
    const h = new FeatureHider(fakeMap)
    h.apply = () => undefined
    const sidings = { layers: ['railways_sidings_'] }
    h.hideAtFirst(sidings)
    expect(h.isHidden(sidings)).toBe(true)
    h.setHidden(sidings, false) // ticked by the user
    h.hideAtFirst(sidings) // the key built again (next visit)
    expect(h.isHidden(sidings)).toBe(false)
  })
})
