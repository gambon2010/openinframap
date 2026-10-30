import { expect, test } from 'vitest'
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
