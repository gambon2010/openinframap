import { describe, expect, test } from 'vitest'
import { attributionFor, isHybridOverlay, parseTiers } from './index.ts'

describe('VITE_SATELLITE_TIERS', () => {
  test('tiers, coarsest first', () => {
    const tiers = parseTiers(
      'http://x/lux.sat-regional/{z}/{x}/{y}.webp 9 12;http://x/lux.sat-overview/{z}/{x}/{y}.jpg 0 8'
    )
    expect(tiers).toEqual([
      { url: 'http://x/lux.sat-overview/{z}/{x}/{y}.jpg', minzoom: 0, maxzoom: 8 },
      { url: 'http://x/lux.sat-regional/{z}/{x}/{y}.webp', minzoom: 9, maxzoom: 12 }
    ])
  })

  test('nothing set, or broken entries left out', () => {
    expect(parseTiers(undefined)).toEqual([])
    expect(parseTiers('')).toEqual([])
    expect(
      parseTiers('http://no-template 0 8;http://x/{z}/{x}/{y}.jpg 9;http://x/{z}/{x}/{y}.jpg 12 9')
    ).toEqual([])
  })
})

test('attribution by tier', () => {
  expect(attributionFor('http://x/lux.sat-overview/{z}/{x}/{y}.jpg')).toContain('NASA')
  expect(attributionFor('http://x/lux.sat-regional/{z}/{x}/{y}.webp')).toContain('Copernicus')
  expect(attributionFor('http://x/lux.sat-detailed/{z}/{x}/{y}.jpg')).toContain('IGN')
  expect(attributionFor('http://x/other/{z}/{x}/{y}.jpg')).toBe('')
})

test('in "satellite with roads", roads, railways and borders stay above the imagery', () => {
  for (const id of [
    'osm_roads_major',
    'osm_roads_tunnels_minor_casing',
    'osm_rail',
    'osm_runway',
    'boundaries_country'
  ])
    expect(isHybridOverlay(id)).toBe(true)
  for (const id of ['osm_water', 'osm_landuse_wood', 'osm_buildings', 'power_line_1'])
    expect(isHybridOverlay(id)).toBe(false)
})
