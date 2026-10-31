import { describe, expect, it } from 'vitest'
import { fieldLabel, fieldValue } from './conflicts.ts'

describe('the conflict window says fields in words', () => {
  it('labels', () => {
    expect(fieldLabel('properties.name')).toBe('Name')
    expect(fieldLabel('geometry')).toBe('Position')
    expect(fieldLabel('modifiers.T')).toBe('Detail T')
    expect(fieldLabel('sidc.identity')).toBe('Identity (friend, hostile...)')
    expect(fieldLabel('style.color')).toBe('Colour')
  })
  it('values', () => {
    expect(fieldValue({ type: 'Point', coordinates: [7.123456, 48.5] })).toBe('48.50000, 7.12346')
    expect(fieldValue(undefined)).toBe('—')
    expect(fieldValue('Alpha')).toBe('Alpha')
  })
})
