import { describe, expect, test } from 'vitest'
import { partLabel, partLayers, partsSummary } from './parts.ts'
import { NOT_A_SITE_OF_ITS_OWN } from './parts.constants.ts'
import layers from './style.ts'

describe("a base's parts", () => {
  test('are named as a person would say them', () => {
    expect(partLabel('bunker', 'building')).toBe('Bunker')
    // A part of another kind: its kind's label.
    expect(partLabel('military_range', 'own_kind')).toBe('Range, training ground')
    // A value not listed: what it is drawn as.
    expect(partLabel('yes', 'building')).toBe('Building')
    expect(partLabel('abandoned', 'zone')).toBe('Part of the site')
  })

  test("a base's parts are counted, the most first as the build gives them", () => {
    expect(partsSummary('bunker:118,barracks:3,military_range:1')).toBe(
      '118 × Bunker, 3 × Barracks building, 1 × Range, training ground'
    )
    expect(partsSummary('')).toBe('')
  })

  test('building and zone parts have no icon nor fill of their own, only their own layers', () => {
    const own = JSON.stringify(['!', NOT_A_SITE_OF_ITS_OWN])
    const military = layers().filter((layer) => layer.id.startsWith('sites_military'))
    for (const id of ['sites_military_area', 'sites_military_area_outline', 'sites_military'])
      expect(JSON.stringify(military.find((layer) => layer.id === id))).toContain(own)
    expect(partLayers().map((layer) => layer.id)).toEqual([
      'sites_military_part_building',
      'sites_military_part_building_outline',
      'sites_military_part_building_3d',
      'sites_military_part_zone',
      'sites_military_part_point'
    ])
  })
})
