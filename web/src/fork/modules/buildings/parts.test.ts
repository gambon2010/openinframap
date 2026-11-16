import { describe, expect, it } from 'vitest'
import { buildingsWithParts, type Shape } from './parts.ts'

const square = (id: number, x0: number, y0: number, x1: number, y1: number): Shape => ({
  id,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0]
      ]
    ]
  }
})

describe('buildings with parts', () => {
  it('are the buildings with a part inside', () => {
    const church = square(1, 0, 0, 10, 10)
    const house = square(2, 20, 0, 25, 5)
    const tower = square(10, 0, 0, 3, 3) // in the church's corner, sharing its edges
    expect(buildingsWithParts([church, house], [tower])).toEqual(new Set([1]))
  })

  it('a building cut over two tiles is found from either piece', () => {
    const west = square(1, 0, 0, 5.1, 10)
    const east = square(1, 4.9, 0, 10, 10)
    const wing = square(10, 7, 2, 9, 4)
    expect(buildingsWithParts([west, east], [wing])).toEqual(new Set([1]))
  })

  it('a part with no building around it marks nothing', () => {
    expect(buildingsWithParts([square(1, 0, 0, 1, 1)], [square(10, 5, 5, 6, 6)])).toEqual(new Set())
  })

  it('inside a building with a courtyard, the courtyard is not inside', () => {
    const cloister: Shape = {
      id: 1,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
            [0, 0]
          ],
          [
            [3, 3],
            [7, 3],
            [7, 7],
            [3, 7],
            [3, 3]
          ]
        ]
      }
    }
    expect(buildingsWithParts([cloister], [square(10, 4, 4, 6, 6)])).toEqual(new Set())
  })
})
