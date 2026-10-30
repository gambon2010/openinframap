import { describe, expect, test } from 'vitest'
import { isHybridOverlay, parseTiers } from './index.ts'

describe('VITE_SATELLITE_TIERS', () => {
  test('tiers, coarsest first', () => {
    const tiers = parseTiers(
      'http://x/lux.sat-regional/{z}/{x}/{y}.webp 9 12|Copernicus (CC BY 4.0);http://x/lux.sat-overview/{z}/{x}/{y}.jpg 0 8|NASA Blue Marble'
    )
    expect(tiers).toEqual([
      {
        url: 'http://x/lux.sat-overview/{z}/{x}/{y}.jpg',
        minzoom: 0,
        maxzoom: 8,
        attribution: 'NASA Blue Marble'
      },
      {
        url: 'http://x/lux.sat-regional/{z}/{x}/{y}.webp',
        minzoom: 9,
        maxzoom: 12,
        attribution: 'Copernicus (CC BY 4.0)'
      }
    ])
    // Written before credits came with the tiers: none.
    expect(parseTiers('http://x/a/{z}/{x}/{y}.jpg 0 8')[0].attribution).toBe('')
  })

  test('nothing set, or broken entries left out', () => {
    expect(parseTiers(undefined)).toEqual([])
    expect(parseTiers('')).toEqual([])
    expect(
      parseTiers('http://no-template 0 8;http://x/{z}/{x}/{y}.jpg 9;http://x/{z}/{x}/{y}.jpg 12 9')
    ).toEqual([])
  })
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
