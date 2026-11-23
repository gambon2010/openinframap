import { describe, expect, test } from 'vitest'
import type { Map } from 'maplibre-gl'
import { placeLabelZooms } from './labels.ts'

/** A map with the label layers of upstream's style (src/style/style_labels.ts). */
function fakeMap() {
  const layers = [
    { id: 'label_places_subplace', minzoom: 13, maxzoom: 14 },
    { id: 'label_places_locality', minzoom: 5.5, maxzoom: 12 },
    { id: 'label_places_region', minzoom: 5, maxzoom: 8 },
    { id: 'label_places_country', minzoom: 2, maxzoom: 8 },
    { id: 'label_roads_major', minzoom: 15 }
  ]
  const ranges: Record<string, [number, number]> = {}
  const map = {
    getStyle: () => ({ layers }),
    getLayer: (id: string) => layers.find((l) => l.id === id),
    setLayerZoomRange: (id: string, min: number, max: number) => (ranges[id] = [min, max]),
    setFilter: () => {},
    on: () => {},
    isStyleLoaded: () => true
  }
  return { map: map as unknown as Map, ranges }
}

describe('place names', () => {
  test("where you are stays at every zoom (from the style's start); countries and regions keep their end", () => {
    const { map, ranges } = fakeMap()
    placeLabelZooms(map)
    expect(ranges).toEqual({
      label_places_subplace: [13, 24],
      label_places_locality: [5.5, 24]
    })
  })
})
