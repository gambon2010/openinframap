import { describe, expect, test } from 'vitest'
import buildings from './index.ts'
import { BUILDINGS_LAYER, PARTS_LAYER } from '../../core/buildings.ts'

const layers = buildings.layers!()
const layer = (id: string) => layers.find((l) => l.id === id)

describe('a click inside a building takes all of it', () => {
  test('flat, only whole buildings: their parts are drawn and clicked in 3D only', () => {
    expect(layer(`${BUILDINGS_LAYER}_hit`)).toMatchObject({ filter: ['==', ['get', 'kind'], 'building'] })
    expect(layer(`${PARTS_LAYER}_hit`)).toBeUndefined()
    expect(layer(PARTS_LAYER)).toBeUndefined()
    expect(layer(`${PARTS_LAYER}_3d`)?.type).toBe('fill-extrusion')
  })
})
