import { describe, expect, it } from 'vitest'
import { View } from './view.ts'
import { UserLayer, isOwner } from '../model/model.ts'

const layer = (access?: UserLayer['access'], locked = false): UserLayer => ({
  id: 'l',
  name: 'L',
  style: locked ? { locked } : {},
  features: new Map(),
  access
})

describe('what can be changed, by access', () => {
  const view = new View()
  it('a layer shared to view is read-only', () => {
    expect(view.canEdit(layer('view'))).toBe(false)
    expect(view.canChangeLayer(layer('view'))).toBe(false)
  })
  it('shared to modify, or yours, can be changed; locked, only the layer itself', () => {
    expect(view.canEdit(layer('modify'))).toBe(true)
    expect(view.canEdit(layer('owner'))).toBe(true)
    expect(view.canEdit(layer('owner', true))).toBe(false)
    expect(view.canChangeLayer(layer('modify', true))).toBe(true)
  })
  it('a layer you just made is yours', () => {
    expect(isOwner(layer())).toBe(true)
    expect(isOwner(layer('modify'))).toBe(false)
  })
})
