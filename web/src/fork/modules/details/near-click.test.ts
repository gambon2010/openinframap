import { expect, test } from 'vitest'
import { lineDistance, segmentDistance } from './near-click.ts'

test('distance to a segment: across, beyond its ends, on it', () => {
  expect(segmentDistance([5, 3], [0, 0], [10, 0])).toBe(3)
  expect(segmentDistance([13, 4], [0, 0], [10, 0])).toBe(5) // past the end: to the end
  expect(segmentDistance([4, 0], [0, 0], [10, 0])).toBe(0)
  expect(segmentDistance([3, 4], [0, 0], [0, 0])).toBe(5) // a point
})

test('distance to a line in several parts: the nearest', () => {
  expect(
    lineDistance(
      [0, 10],
      [
        [
          [0, 0],
          [0, 5]
        ],
        [
          [-3, 12],
          [3, 12]
        ]
      ]
    )
  ).toBe(2)
})
