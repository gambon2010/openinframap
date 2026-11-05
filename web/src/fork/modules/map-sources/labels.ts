// Fork: place names when zoomed in. Upstream's background map shows town names up to
// zoom 12 and neighbourhood names at 13-14 only (online, the OpenStreetMap layer took
// over from there). Offline nothing does, and close in you'd lose which town you're
// in. Town names stay at every zoom; field and neighbourhood names (many: "Holzweg",
// "Im Tal", OSM's place=locality, which the background map files with towns as
// kind_detail "locality") only once zoomed in close.
import { FilterSpecification, Map } from 'maplibre-gl'

/** From this zoom on, field and neighbourhood names too. */
export const CLOSE_ZOOM = 17
/** Upstream shows every locality below this zoom (the tiles have few there). */
const UPSTREAM_MAX = 12

/** Towns, villages and hamlets at every zoom; field names (kind_detail locality)
 * below upstream's limit, then again once zoomed in close. */
export const LOCALITY_FILTER = [
  'all',
  ['==', ['get', 'kind'], 'locality'],
  [
    'any',
    ['!=', ['get', 'kind_detail'], 'locality'],
    ['<', ['zoom'], UPSTREAM_MAX],
    ['>=', ['zoom'], CLOSE_ZOOM]
  ]
] as FilterSpecification

export function placeLabelZooms(map: Map) {
  const apply = () => {
    if (map.getLayer('label_places_locality')) {
      map.setLayerZoomRange('label_places_locality', 5.5, 24)
      map.setFilter('label_places_locality', LOCALITY_FILTER)
    }
    if (map.getLayer('label_places_subplace')) map.setLayerZoomRange('label_places_subplace', CLOSE_ZOOM, 24)
  }
  map.on('style.load', apply)
  if (map.isStyleLoaded()) apply()
}
