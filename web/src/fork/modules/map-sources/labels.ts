// Fork: place names when zoomed in. Upstream's background map shows town names up to
// zoom 12 and neighbourhood names at 13-14 only (online, the OpenStreetMap layer took
// over from there). Offline nothing does, and close in you'd lose which town you're
// in: town names stay at every zoom; neighbourhood and field names (many) only come
// once zoomed in close.
import { Map } from 'maplibre-gl'

/** Upstream's place labels (style/style_labels.ts) and the zooms they're shown at. */
export const PLACE_LABEL_ZOOMS: Record<string, [number, number]> = {
  label_places_locality: [5.5, 24],
  label_places_subplace: [17, 24]
}

export function placeLabelZooms(map: Map) {
  const apply = () => {
    for (const [id, [min, max]] of Object.entries(PLACE_LABEL_ZOOMS)) {
      if (map.getLayer(id)) map.setLayerZoomRange(id, min, max)
    }
  }
  map.on('style.load', apply)
  if (map.isStyleLoaded()) apply()
}
