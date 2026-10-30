import { describe, expect, test } from 'vitest'
import { UserFeature, UserLayer } from './model.ts'
import { byFolder, matches } from './outliner.ts'
import { featureLabelParts } from './labels.ts'

const symbol = (sidc: string, modifiers: Record<string, string> = {}, notes?: string): UserFeature => ({
  type: 'Feature',
  id: sidc,
  geometry: { type: 'Point', coordinates: [0, 0] },
  properties: { kind: 'symbol', sidc, modifiers, notes }
})
const layer = (id: string, folder?: string): UserLayer => ({
  id,
  name: id,
  style: { folder },
  features: new Map()
})

describe('search and filters', () => {
  const friendUnit = symbol('SFGPUCI----F---', { T: '2nd Bn', M: '1st Bde' }, 'seen by the bridge')
  const hostilePlanned = symbol('SHGAUCI--------', { T: '45th Bn' })
  const tank = symbol('SHGPEVAT-------')
  const none = new Set<never>()

  test('text: every word, in the name, type, details or notes', () => {
    expect(matches(friendUnit, '2nd', none)).toBe(true)
    expect(matches(friendUnit, 'infantry 1st', none)).toBe(true)
    expect(matches(friendUnit, 'bridge', none)).toBe(true)
    expect(matches(friendUnit, '45th', none)).toBe(false)
    expect(matches(friendUnit, '', none)).toBe(true)
  })

  test('filters', () => {
    expect(matches(hostilePlanned, '', new Set(['hostile', 'planned']))).toBe(true)
    expect(matches(friendUnit, '', new Set(['hostile']))).toBe(false)
    expect(matches(friendUnit, '', new Set(['friend', 'units']))).toBe(true)
    expect(matches(tank, '', new Set(['units']))).toBe(false)
    expect(matches(tank, '', new Set(['graphics']))).toBe(false)
  })
})

test('layers by folder: folders sorted, loose layers last', () => {
  const out = byFolder([layer('a'), layer('b', 'Zulu'), layer('c', 'Alpha'), layer('d', 'Zulu')])
  expect(out.map(([f, l]) => [f, l.map((x) => x.id)])).toEqual([
    ['Alpha', ['c']],
    ['Zulu', ['b', 'd']],
    [null, ['a']]
  ])
  expect(byFolder([layer('a', '  ')])).toEqual([[null, [expect.objectContaining({ id: 'a' })]]])
})

test('an item in a few words', () => {
  const now = new Date(Date.UTC(2026, 9, 30, 12, 0))
  const parts = featureLabelParts(symbol('SHGAUCI--------', { T: '45th Bn', W: '301000ZOCT26' }), now)
  expect(parts).toEqual({ name: '45th Bn', what: 'Infantry', detail: 'Hostile · planned · 2 h ago' })
})
