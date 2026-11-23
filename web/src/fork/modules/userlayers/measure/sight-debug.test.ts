import { describe, expect, test } from 'vitest'
import { checkSight, dropOf, expectedDrop } from './sight-debug.ts'
import type { ProfilePoint, SightResult } from './sight.ts'

const RADIUS = 6_371_008.8
const COEFFICIENT = 6 / 7
const drop = (d: number) => (COEFFICIENT * d * d) / (2 * RADIUS)

/** A sample whose top is lowered as the formula says. */
const sample = (distance: number, ground: number, standing = 0): ProfilePoint => [
  distance,
  ground,
  true,
  standing,
  standing ? 'trees' : '',
  ground + standing - drop(distance)
]

const answer = (profile: ProfilePoint[], eye: number, targetTop: number): SightResult => ({
  target_seen: true,
  blocked_at: null,
  blocked_by: null,
  margin: null,
  eye,
  target_top: targetTop,
  obstacles_counted: true,
  through_trees: false,
  curvature: { coefficient: COEFFICIENT, earth_radius: RADIUS },
  profile
})

describe('a line of sight checked against itself', () => {
  test('trees then the ground: hidden first where the ground rises above the line', () => {
    // A level line at 200 m: trees reach 210 m at 50 m (their ground 190 m), the
    // ground itself 205 m at 100 m.
    const profile: ProfilePoint[] = [
      [0, 198, true, 0, '', 200],
      [50, 190, true, 20, 'trees', 210],
      [100, 205, false, 0, '', 205],
      [150, 198, false, 0, '', 200]
    ]
    expect(checkSight(answer(profile, 200, 200)).firstHiding).toBe(100)
  })

  test('the lowering at 92 km is about 570 m (6/7 of the bare curvature)', () => {
    const result = answer([sample(0, 200)], 202, 0)
    expect(expectedDrop(result, 92_000)).toBeCloseTo(569.4, 1)
  })

  test('a profile lowered by the formula has no error', () => {
    const profile = [sample(0, 200), sample(10_000, 150, 15), sample(20_000, 100)]
    const check = checkSight(answer(profile, 202, 100 - drop(20_000)))
    expect(check.worstDropError).toBeLessThan(1e-9)
    expect(check.dropAtEnd).toBeCloseTo(drop(20_000), 6)
    expect(check.spacing).toBe(10_000)
  })

  test('a sample lowered wrongly shows as the worst error', () => {
    const wrong: ProfilePoint = [10_000, 150, true, 0, '', 150]
    const check = checkSight(answer([sample(0, 200), wrong, sample(20_000, 100)], 202, 0))
    expect(check.worstDropError).toBeCloseTo(drop(10_000), 6)
  })

  test('the margin and where it is first hidden, from the profile', () => {
    // A level line at 200 m: the middle sample's top rises 10 m above it.
    const profile: ProfilePoint[] = [
      [0, 198, true, 0, '', 200],
      [50, 100, true, 0, '', 190],
      [100, 100, true, 0, '', 210],
      [150, 198, true, 0, '', 200]
    ]
    const check = checkSight(answer(profile, 200, 200))
    expect(check.margin).toBe(-10)
    expect(check.firstHiding).toBe(100)
  })

  test('no terrain: no drop, no margin', () => {
    const none: ProfilePoint = [0, null, false, 0, '', null]
    expect(dropOf(none)).toBeNull()
    const check = checkSight(answer([none, none], 2, 0))
    expect(check.margin).toBeNull()
    expect(check.firstHiding).toBeNull()
  })
})
