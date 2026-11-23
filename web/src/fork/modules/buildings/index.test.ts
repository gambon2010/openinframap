import { describe, expect, test } from 'vitest'
import buildings from './index.ts'
import { BUILDINGS_LAYER, FROM_TILES_WITH_EVERY_BUILDING, PARTS_LAYER } from '../../core/buildings.ts'

const layers = buildings.layers!()
const layer = (id: string) => layers.find((l) => l.id === id)
/** A layer's filter (background layers have none). */
const filterOf = (id: string) => (layer(id) as { filter?: unknown } | undefined)?.filter

describe('a click inside a building takes all of it', () => {
  test('flat, only whole buildings: their parts are drawn and clicked in 3D only', () => {
    expect(layer(`${BUILDINGS_LAYER}_hit`)).toMatchObject({
      filter: ['all', ['==', ['get', 'kind'], 'building'], FROM_TILES_WITH_EVERY_BUILDING]
    })
    expect(layer(`${PARTS_LAYER}_hit`)).toBeUndefined()
    expect(layer(PARTS_LAYER)).toBeUndefined()
    expect(layer(`${PARTS_LAYER}_3d`)?.type).toBe('fill-extrusion')
  })
})

describe("Protomaps' merged blocks of buildings (tiles below zoom 15)", () => {
  // Bug: zoomed out, a click took in a whole block of houses as one building.
  test('are never drawn or clicked as buildings', () => {
    for (const id of [BUILDINGS_LAYER, `${BUILDINGS_LAYER}_hit`, `${BUILDINGS_LAYER}_shadow`])
      expect(JSON.stringify(filterOf(id))).toContain(JSON.stringify(FROM_TILES_WITH_EVERY_BUILDING))
    expect(FROM_TILES_WITH_EVERY_BUILDING).toEqual(['>=', ['zoom'], 15])
  })
})
