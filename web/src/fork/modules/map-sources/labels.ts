// Fork: place names when zoomed in. Upstream's background map shows town names up to
// zoom 12 and neighbourhood names at 13-14 only (online, the OpenStreetMap layer took
// over from there). Offline nothing does, and close in you'd lose which town you're
// in: town and neighbourhood names stay at every zoom. Field names ("Holzweg", "Im
// Tal": OSM's place=locality, the cadastre's lieux-dits, dozens per village, which
// the background map files with towns as kind_detail "locality") are never shown.
import { FilterSpecification, Map } from 'maplibre-gl'

/** Towns, villages and hamlets; not field names. */
export const LOCALITY_FILTER = [
  'all',
  ['==', ['get', 'kind'], 'locality'],
  ['!=', ['get', 'kind_detail'], 'locality']
] as FilterSpecification

export function placeLabelZooms(map: Map) {
  const apply = () => {
    if (map.getLayer('label_places_locality')) {
      map.setLayerZoomRange('label_places_locality', 5.5, 24)
      map.setFilter('label_places_locality', LOCALITY_FILTER)
    }
    // Neighbourhoods from upstream's zoom 13, then on.
    if (map.getLayer('label_places_subplace')) map.setLayerZoomRange('label_places_subplace', 13, 24)
  }
  map.on('style.load', apply)
  if (map.isStyleLoaded()) apply()
}
