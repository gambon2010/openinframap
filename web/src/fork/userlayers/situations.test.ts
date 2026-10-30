import { expect, test } from 'vitest'
import { SavedChange } from './model.ts'
import { situationPosition } from './situations.ts'
import { Situation } from './api.ts'

const change = (id: number): SavedChange => ({
  id,
  save_id: 1,
  saved_at: '',
  author: null,
  note: null,
  op: 'layer_create',
  layer_id: 'L',
  feature_id: null,
  after: null,
  made_at: ''
})

test('a situation includes its change and every earlier one', () => {
  const situation = { id: 1, name: 'x', change_id: 7, author: null, created_at: '', at: null } as Situation
  expect(situationPosition([3, 5, 7, 9, 12].map(change), situation)).toBe(3)
  expect(situationPosition([], situation)).toBe(0)
})
