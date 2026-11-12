import { describe, expect, test } from 'vitest'
import { UserFeature, UserLayer } from '../../model/model.ts'
import { byFolder, layerOrder, placed, sortLayers } from './order.ts'
import { matches, textMatches } from './filter.ts'
import { PersonalSettings } from '../../state/personal.ts'
import { featureLabelParts } from '../../model/labels.ts'

const symbol = (sidc: string, modifiers: Record<string, string> = {}, notes?: string): UserFeature => ({
  type: 'Feature',
  id: sidc,
  geometry: { type: 'Point', coordinates: [0, 0] },
  properties: { kind: 'symbol', sidc, modifiers, notes }
})
const layer = (id: string): UserLayer => ({ id, name: id, style: {}, features: new Map() })
const folders: Record<string, string> = { b: 'Zulu', c: 'Alpha', d: 'Zulu', e: '  ' }
const folderOf = (l: UserLayer) => folders[l.id]?.trim() || null

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
  const out = byFolder([layer('a'), layer('b'), layer('c'), layer('d')], [], folderOf)
  expect(out.map(([f, l]) => [f, l.map((x) => x.id)])).toEqual([
    ['Alpha', ['c']],
    ['Zulu', ['b', 'd']],
    [null, ['a']]
  ])
  expect(byFolder([layer('e')], [], folderOf)).toEqual([[null, [expect.objectContaining({ id: 'e' })]]])
})

test('an item in a few words', () => {
  const now = new Date(Date.UTC(2026, 9, 30, 12, 0))
  const parts = featureLabelParts(symbol('SHGAUCI--------', { T: '45th Bn', W: '301000ZOCT26' }), now)
  expect(parts).toEqual({ name: '45th Bn', what: 'Infantry', detail: 'Hostile · planned · 2 h ago' })
})

describe('the order of layers', () => {
  const ids = (layers: UserLayer[]) => layers.map((l) => l.id)

  test('the ones placed keep their place; new ones come first, newest first', () => {
    const layers = ['a', 'b', 'c', 'd'].map((id) => layer(id))
    expect(ids(sortLayers(layers, []))).toEqual(['d', 'c', 'b', 'a'])
    expect(ids(sortLayers(layers, ['b', 'a']))).toEqual(['d', 'c', 'b', 'a'])
    expect(ids(sortLayers(layers, ['a', 'c', 'b', 'd']))).toEqual(['a', 'c', 'b', 'd'])
  })

  test('a layer dropped above or below another', () => {
    expect(placed(['a', 'b', 'c'], 'c', 'a', true)).toEqual(['c', 'a', 'b'])
    expect(placed(['a', 'b', 'c'], 'a', 'c', false)).toEqual(['b', 'c', 'a'])
    expect(placed(['a', 'b', 'c'], 'a', 'x', true)).toEqual(['a', 'b', 'c'])
  })

  test("the list's order is the drawing order: folders first, as shown", () => {
    localStorage.clear()
    const personal = new PersonalSettings()
    personal.data.order = ['loose', 'f2', 'f1']
    personal.setFolder('f1', 'Folder')
    personal.setFolder('f2', 'Folder')
    expect(layerOrder([layer('f1'), layer('f2'), layer('loose')], personal)).toEqual(['f2', 'f1', 'loose'])
  })
})

test('layers and folders found by name: every word, anywhere', () => {
  expect(textMatches('Enemy forces north', 'enemy NORTH')).toBe(true)
  expect(textMatches('Enemy forces', 'enemy south')).toBe(false)
})
