import { describe, expect, test } from 'vitest'
import { terrainBefore } from './placement.ts'

const LAYERS = [
  'osm_background',
  'osm_landcover_wood',
  'osm_water',
  'osm_landuse_pier',
  'osm_roads_tunnels_other_casing',
  'osm_buildings',
  'osm_roads_minor',
  'satellite_0',
  'roads_minor',
  'power_line',
  'label_places_locality'
]

describe('terrainBefore', () => {
  test('over the map: on the land cover and water, under the first road or building', () => {
    expect(terrainBefore(LAYERS, false)).toBe('osm_roads_tunnels_other_casing')
  })

  test('over imagery: right above the photos, under the first data layer', () => {
    expect(terrainBefore(LAYERS, true)).toBe('roads_minor')
  })

  test('nothing over it: the top', () => {
    expect(terrainBefore(['osm_background', 'osm_water'], false)).toBeUndefined()
  })
})
