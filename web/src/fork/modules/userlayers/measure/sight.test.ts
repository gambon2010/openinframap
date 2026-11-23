import { describe, expect, test } from 'vitest'
import {
  DEFAULT_SIGHT,
  noticeableRuns,
  sightKey,
  sightRuns,
  sightStretches,
  type ProfilePoint,
  type SightResult
} from './sight.ts'
import { sightBlockLabel, sightVerdict } from './sight-verdict.ts'
import { niceStep, sightChart, steppedSample } from './sight-chart.ts'

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
    obstacles_counted: true,
    through_trees: false,
    curvature: { coefficient: 6 / 7, earth_radius: 6_371_008.8 },
    profile,
    ...changes
  }
}

describe('a line of sight on the map', () => {
  test('green where the line passes over everything, red where something rises above it', () => {
    // The eye at 202 m, the target's top at 200 m: a rise of 260 m at 50 m and 210 m at
    // 75 m stand above the line.
    const result = answer([row(0, 200, true), row(50, 260, true), row(75, 210, false), row(100, 200, false)])
    // Each run takes the state where it ends, and starts where the last ended.
    expect(sightRuns(result)).toEqual([
      { state: 'blocked', start: 0, end: 75 },
      { state: 'clear', start: 75, end: 100 }
    ])
  })

  test('yellow where only trees rise above the line, red where the ground does', () => {
    // The eye at 202 m, the target's top at 200 m: trees 20 m tall on 195 m ground at
    // 25 m (their ground under the line), then the ground itself at 250 m.
    const result = answer([
      row(0, 200, true),
      row(25, 195, true, 20, 'trees'),
      row(50, 250, false),
      row(100, 200, false)
    ])
    expect(sightRuns(result).map((run) => run.state)).toEqual(['trees', 'blocked', 'clear'])
  })

  test('drawn green first and red last, each stretch from its start to its end', () => {
    const result = answer([row(0, 200, true), row(50, 260, true), row(75, 210, false), row(100, 200, false)])
    expect(sightStretches([0, 0], [1, 0], result)).toEqual([
      {
        state: 'clear',
        points: [
          [0.75, 0],
          [1, 0]
        ]
      },
      {
        state: 'blocked',
        points: [
          [0, 0],
          [0.75, 0]
        ]
      }
    ])
  })

  test('no terrain: nothing drawn there', () => {
    const result = answer([row(0, null, false), row(10, null, false)], {
      target_seen: null,
      blocked_at: null
    })
    expect(sightStretches([0, 0], [1, 0], result)).toEqual([])
  })

  test('the answer changes with either point or height', () => {
    const key = (changes: Partial<typeof DEFAULT_SIGHT>) =>
      sightKey([1, 2], [3, 4], { ...DEFAULT_SIGHT, ...changes })
    expect(key({})).not.toBe(key({ target: 10 }))
    expect(key({})).not.toBe(key({ trees: 20 }))
  })
})

describe('what a line of sight says', () => {
  test('what hides the target, where, by how much', () => {
    const trees = answer([row(0, 200, true), row(50, 200, true, 20, 'trees'), row(100, 200, false)], {
      blocked_by: 'trees',
      through_trees: true
    })
    expect(sightVerdict(trees, DEFAULT_SIGHT)).toBe(
      'Through trees 50 m away: may be seen (trees taken as 15 m)'
    )
    expect(sightBlockLabel(trees)).toBe('Trees 20 m')
    const ridge = answer([row(0, 200, true), row(50, 214, true), row(100, 200, false)])
    expect(sightVerdict(ridge, DEFAULT_SIGHT)).toBe('Hidden by the ground 50 m away (12 m above the line)')
    expect(
      sightVerdict(
        answer([], { target_seen: true, blocked_at: null, blocked_by: null, margin: 7.6 }),
        DEFAULT_SIGHT
      )
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

describe('a short break in a long line of sight', () => {
  const runs = [
    { state: 'clear' as const, start: 0, end: 500 },
    { state: 'blocked' as const, start: 500, end: 502 },
    { state: 'clear' as const, start: 502, end: 1000 }
  ]

  test('widened about its middle to the least length, drawn on top', () => {
    const drawn = noticeableRuns(runs, 40)
    expect(drawn.at(-1)).toEqual({ state: 'blocked', start: 481, end: 521 })
  })

  test('at an end of the line: widened inwards, kept on the line', () => {
    const atEnd = [
      { state: 'clear' as const, start: 0, end: 998 },
      { state: 'trees' as const, start: 998, end: 1000 }
    ]
    expect(noticeableRuns(atEnd, 40).at(-1)).toEqual({ state: 'trees', start: 960, end: 1000 })
  })

  test('long enough already, or clear: as it is', () => {
    expect(noticeableRuns(runs, 2)).toEqual([runs[0], runs[2], runs[1]])
  })
})

describe('moving along the profile with the arrows', () => {
  const key = (k: string, shiftKey = false) => new KeyboardEvent('keydown', { key: k, shiftKey })

  test('from nothing shown: → starts at the eye, ← at the target', () => {
    expect(steppedSample(null, 1000, key('ArrowRight'))).toBe(0)
    expect(steppedSample(null, 1000, key('ArrowLeft'))).toBe(999)
  })

  test('a two-hundredth of the line a step, one sample with Shift, within the line', () => {
    expect(steppedSample(100, 1000, key('ArrowRight'))).toBe(105)
    expect(steppedSample(100, 1000, key('ArrowLeft', true))).toBe(99)
    expect(steppedSample(998, 1000, key('ArrowRight'))).toBe(999)
  })

  test('another key, or no samples: not ours', () => {
    expect(steppedSample(0, 1000, key('a'))).toBeUndefined()
    expect(steppedSample(null, 0, key('ArrowRight'))).toBeUndefined()
  })
})
