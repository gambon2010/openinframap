import { describe, expect, test } from 'vitest'
import { sightKey, sightStretches, type SightResult } from './sight.ts'

describe('a line of sight on the map', () => {
  test('cut where what is seen changes, the stretches meeting', () => {
    const result: SightResult = {
      target_seen: false,
      blocked_at: 50,
      profile: [
        [0, 200, true],
        [50, 260, true],
        [75, 210, false],
        [100, 200, false]
      ]
    }
    const stretches = sightStretches([0, 0], [1, 0], result)
    expect(stretches.map((s) => s.seen)).toEqual([true, false])
    expect(stretches[0].points).toEqual([
      [0, 0],
      [0.5, 0]
    ])
    expect(stretches[1].points[0]).toEqual([0.5, 0])
    expect(stretches[1].points.at(-1)).toEqual([1, 0])
  })

  test('no terrain: nothing drawn there', () => {
    const result: SightResult = {
      target_seen: null,
      blocked_at: null,
      profile: [
        [0, null, false],
        [10, null, false]
      ]
    }
    expect(sightStretches([0, 0], [1, 0], result)).toEqual([])
  })

  test('the answer changes with either point or height', () => {
    expect(sightKey([1, 2], [3, 4], 2, 0)).not.toBe(sightKey([1, 2], [3, 4], 2, 10))
  })
})
