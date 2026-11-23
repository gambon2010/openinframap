import { describe, expect, test } from 'vitest'
import { View } from './view.ts'
import { UserLayer } from '../model/model.ts'

const layer = (locked?: boolean): UserLayer => ({
  id: 'a',
  name: 'A',
  style: { locked },
  features: new Map()
})

test('live layers can be changed, unless locked; nothing in the past can', () => {
  const view = new View()
  expect(view.canEdit(layer())).toBe(true)
  expect(view.canEdit(layer(true))).toBe(false)
  expect(view.canEdit(undefined)).toBe(false)
  view.showSituation({ id: 1, name: 'Noon', change_id: 3, author: null, created_at: '', at: null }, new Map())
  expect(view.live).toBe(false)
  expect(view.canEdit(layer())).toBe(false)
  view.showPlayback()
  expect(view.situation).toBeNull()
  expect(view.canEdit(layer())).toBe(false)
  view.goLive()
  expect(view.canEdit(layer())).toBe(true)
})

describe('one item locked', () => {
  test("can't be changed, moved or deleted; the rest of its layer can", () => {
    const view = new View()
    const layer = { id: 'l', name: 'L', style: {}, features: new Map() } as never
    const free = {
      type: 'Feature',
      id: 'a',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { kind: 'marker' }
    } as never
    const locked = {
      type: 'Feature',
      id: 'b',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { kind: 'measure', locked: true }
    } as never
    expect(view.canEditItem(layer, free)).toBe(true)
    expect(view.canEditItem(layer, locked)).toBe(false)
    expect(view.canEdit(layer)).toBe(true)
  })
})
