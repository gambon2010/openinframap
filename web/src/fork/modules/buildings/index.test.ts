import { describe, expect, test } from 'vitest'
import buildings from './index.ts'
import { BUILDINGS_LAYER, PARTS_LAYER } from '../../core/buildings.ts'

const layers = buildings.layers!()
const layer = (id: string) => layers.find((l) => l.id === id)!

describe('a click inside a building takes all of it', () => {
  test('whole buildings are found before their parts', () => {
    // Clicks and the copy tool take the topmost layer under the pointer.
    const building = layer(`${BUILDINGS_LAYER}_hit`).zorder ?? 0
    const part = layer(`${PARTS_LAYER}_hit`).zorder ?? 0
    expect(building).toBeGreaterThan(part)
  })

  test('each layer holds one kind', () => {
    expect(layer(`${BUILDINGS_LAYER}_hit`)).toMatchObject({ filter: ['==', ['get', 'kind'], 'building'] })
    expect(layer(`${PARTS_LAYER}_hit`)).toMatchObject({ filter: ['==', ['get', 'kind'], 'building_part'] })
  })

  test('parts are still drawn', () => {
    expect(layer(PARTS_LAYER).type).toBe('line')
  })
})
