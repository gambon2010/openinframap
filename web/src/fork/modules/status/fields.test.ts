import { describe, expect, it } from 'vitest'
import { detailsText, fieldsFor } from './fields.ts'

describe('status fields', () => {
  it('depend on the kind of site', () => {
    expect(fieldsFor('sites_point', 'supermarket').map((f) => f.key)).toEqual(['stock', 'short'])
    expect(fieldsFor('sites_area', 'hospital').map((f) => f.key)).toEqual(['capacity'])
    expect(fieldsFor('sites_point', 'fuel_depot').map((f) => f.key)).toEqual(['stock', 'short', 'fuel'])
    expect(fieldsFor('sites_point', 'christian')).toEqual([])
    expect(fieldsFor('power_line', 'supermarket')).toEqual([])
  })

  it('are written out with their labels', () => {
    expect(detailsText({ stock: 'low', short: 'water' })).toBe('Stock: Low · What is short: water')
    expect(detailsText({})).toBe('')
    expect(detailsText(undefined)).toBe('')
  })
})
