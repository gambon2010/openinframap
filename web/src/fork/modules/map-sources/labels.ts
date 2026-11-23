// Fork: place names when zoomed in. One rule: the name of where you are (a town,
// village, hamlet or neighbourhood) never disappears when zooming in. Upstream's
// background style stops them at zoom 12 (towns) and 14 (neighbourhoods); every
// place-name layer ending after zoom 10 is kept to the closest zoom, from the zoom
// it starts at in the style. Names of large areas (countries, regions: they end at
// 8) keep upstream's limits: zoomed in they're noise. Field names ("Holzweg", "Im
// Tal": OSM's place=locality, the cadastre's lieux-dits, dozens per village, which
// the background map files with towns as kind_detail "locality") are never shown.
import { FilterSpecification, Map } from 'maplibre-gl'

/** Towns, villages and hamlets; not field names. */
export const LOCALITY_FILTER = [
  'all',
  ['==', ['get', 'kind'], 'locality'],
  ['!=', ['get', 'kind_detail'], 'locality']
] as FilterSpecification

/** A place-name layer ending after this zoom names where you are (not a country). */
const LOCAL_FROM = 10

export function placeLabelZooms(map: Map) {
  const apply = () => {
    for (const layer of map.getStyle()?.layers ?? []) {
      if (!layer.id.startsWith('label_places_')) continue
      if (layer.maxzoom !== undefined && layer.maxzoom > LOCAL_FROM)
        map.setLayerZoomRange(layer.id, layer.minzoom ?? 0, 24)
    }
    if (map.getLayer('label_places_locality')) map.setFilter('label_places_locality', LOCALITY_FILTER)
  }
  map.on('style.load', apply)
  if (map.isStyleLoaded()) apply()
}
