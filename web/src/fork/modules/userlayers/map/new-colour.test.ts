import { beforeEach, describe, expect, test } from 'vitest'
import { newItemColour, setNewItemColour, withNewColour } from './new-colour.ts'

describe('the colour of new items', () => {
  beforeEach(() => localStorage.clear())

  test('black until one is chosen', () => {
    expect(newItemColour()).toBe('#000000')
    setNewItemColour('#1976d2')
    expect(newItemColour()).toBe('#1976d2')
  })

  test('given to new items of kinds with a colour, not to others or ones that have one', () => {
    setNewItemColour('#1976d2')
    expect(withNewColour({ kind: 'drawing' }).color).toBe('#1976d2')
    expect(withNewColour({ kind: 'marker' }).color).toBe('#1976d2')
    expect(withNewColour({ kind: 'measure', measure: 'distance' }).color).toBe('#1976d2')
    expect(withNewColour({ kind: 'drawing', color: '#ff0000' }).color).toBe('#ff0000')
    expect(withNewColour({ kind: 'image', image: 'x' }).color).toBeUndefined()
  })
})
