import { describe, expect, test } from 'vitest'
import { sightKey, sightStretches, type ProfilePoint, type SightResult } from './sight.ts'
import { sightBlockLabel, sightVerdict } from './sight-verdict.ts'
import { niceStep, sightChart } from './sight-chart.ts'

/** A profile row: distance, ground, seen, and optionally what stands there. */
const row = (
  d: number,
  ground: number | null,
  seen: boolean,
  standing = 0,
  kind: '' | 'building' | 'trees' = ''
): ProfilePoint => [d, ground, seen, standing, kind, ground === null ? null : ground + standing]

/** An answer (the backend's shape) with these rows and the rest made up. */
function answer(profile: ProfilePoint[], changes: Partial<SightResult> = {}): SightResult {
  return {
    target_seen: false,
    blocked_at: 50,
    blocked_by: 'ground',
    margin: -12,
    eye: 202,
    target_top: 200,
    profile,
    ...changes
  }
}

describe('a line of sight on the map', () => {
  test('cut where what is seen changes, the stretches meeting', () => {
    const result = answer([row(0, 200, true), row(50, 260, true), row(75, 210, false), row(100, 200, false)])
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
    const result = answer([row(0, null, false), row(10, null, false)], {
      target_seen: null,
      blocked_at: null
    })
    expect(sightStretches([0, 0], [1, 0], result)).toEqual([])
  })

  test('the answer changes with either point or height', () => {
    expect(sightKey([1, 2], [3, 4], 2, 0)).not.toBe(sightKey([1, 2], [3, 4], 2, 10))
  })
})

describe('what a line of sight says', () => {
  test('what hides the target, where, by how much', () => {
    const trees = answer([row(0, 200, true), row(50, 200, true, 20, 'trees'), row(100, 200, false)], {
      blocked_by: 'trees'
    })
    expect(sightVerdict(trees)).toBe('Hidden by trees 50 m away (12 m above the line)')
    expect(sightBlockLabel(trees)).toBe('Trees 20 m')
    expect(
      sightVerdict(answer([], { target_seen: true, blocked_at: null, blocked_by: null, margin: 7.6 }))
    ).toBe('Seen (8 m clear)')
  })
})

describe('the profile chart', () => {
  test('round ticks: 1, 2 or 5 times a power of ten', () => {
    expect(niceStep(91800)).toBe(20000)
    expect(niceStep(600)).toBe(100)
    expect(niceStep(7)).toBe(2)
  })

  test('says which sample is under the pointer, and nothing when it leaves', () => {
    const result = answer([row(0, 200, true), row(50, 260, true, 15, 'building'), row(100, 200, false)])
    const hovered: (ProfilePoint | null)[] = []
    const chart = sightChart(result, (point) => hovered.push(point))
    document.body.append(chart)
    chart.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 520 }) as DOMRect
    // The chart's middle (x 500 of 1000, past its left margin): the sample at 50 m.
    chart.dispatchEvent(new PointerEvent('pointermove', { clientX: 532 }))
    chart.dispatchEvent(new PointerEvent('pointerleave'))
    expect(hovered[0]?.[0]).toBe(50)
    expect(hovered[1]).toBeNull()
    // The building drawn on the ground, and the mark where the target is hidden.
    expect(chart.querySelector('.oim-ul-sight-building')).not.toBeNull()
    expect(chart.querySelector('.oim-ul-sight-block')).not.toBeNull()
    chart.remove()
  })
})
