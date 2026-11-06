import { describe, expect, test } from 'vitest'
import { assignSections } from './data-layers.ts'

const styleLayers = [
  { id: 'power_line_1', type: 'line', paint: { 'line-color': '#ff0000' } },
  { id: 'power_plant', type: 'fill' },
  { id: 'telecoms_line', type: 'line' },
  { id: 'site_points', type: 'symbol' }
]
const entries = [
  { id: 'P', title: 'Power', prefix: 'power_' },
  { id: 'T', title: 'Telecoms', prefix: 'telecoms_' },
  { id: 'H', title: 'Health and emergency', prefix: 'site_' },
  { id: 'M', title: 'Military', prefix: 'site_' },
  { id: 'S', title: 'Damage and threats', prefix: 'status_' }
]

describe('Data layers: which entry a key section goes under', () => {
  test('the entry of the same name, else the one drawing its layers, else none', () => {
    const owner = assignSections(
      [
        { title: 'Power Lines', specs: [{ layers: ['power_line'] }] },
        { title: 'Power Plants', specs: [{ layers: ['power_plant'] }] },
        { title: 'Telecoms', specs: [{ layers: ['telecoms_line'] }] },
        // Sites share their layers: by name.
        { title: 'Military', specs: [{ layers: ['site_points'] }] },
        // A key with no tick boxes: by name.
        { title: 'Damage and threats', specs: [] },
        { title: 'Something else', specs: [] }
      ],
      entries,
      styleLayers
    )
    expect(owner).toEqual({
      'Power Lines': 'P',
      'Power Plants': 'P',
      Telecoms: 'T',
      Military: 'M',
      'Damage and threats': 'S',
      'Something else': null
    })
  })
})
