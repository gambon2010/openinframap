// Fork: the measurements on the map: one GeoJSON source (features.ts makes its
// data) and its layers: areas, lines (dashed while being made), points, labels.
import { GeoJSONSource, Map } from 'maplibre-gl'
import { font } from '../../../style/common.ts'

const SOURCE = 'oim-measure'
const COLOUR = '#d6336c'

/** Show these features (adding the source and layers if the style lost them; if
 * the style isn't ready, once it is). */
export function drawMeasurements(map: Map, data: GeoJSON.FeatureCollection) {
  const source = map.getSource(SOURCE) as GeoJSONSource | undefined
  if (source) {
    source.setData(data)
    return
  }
  try {
    map.addSource(SOURCE, { type: 'geojson', data })
  } catch {
    map.once('idle', () => drawMeasurements(map, data))
    return
  }
  map.addLayer({
    id: 'oim-measure-fill',
    type: 'fill',
    source: SOURCE,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': COLOUR, 'fill-opacity': 0.12 }
  })
  // What's being made: dashed.
  for (const draft of [false, true]) {
    map.addLayer({
      id: `oim-measure-line${draft ? '-draft' : ''}`,
      type: 'line',
      source: SOURCE,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'draft'], draft]],
      paint: { 'line-color': COLOUR, 'line-width': 2.5, ...(draft ? { 'line-dasharray': [2, 2] } : {}) }
    })
  }
  map.addLayer({
    id: 'oim-measure-vertex',
    type: 'circle',
    source: SOURCE,
    filter: ['==', ['get', 'vertex'], true],
    paint: {
      'circle-radius': 4,
      'circle-color': '#fff',
      'circle-stroke-color': COLOUR,
      'circle-stroke-width': 2
    }
  })
  map.addLayer({
    id: 'oim-measure-label',
    type: 'symbol',
    source: SOURCE,
    filter: ['has', 'label'],
    layout: {
      'text-field': ['get', 'label'],
      'text-font': font,
      'text-size': ['case', ['get', 'big'], 14, 12],
      'text-offset': [0, -1.1],
      'text-allow-overlap': true,
      'text-ignore-placement': true
    },
    paint: { 'text-color': '#222', 'text-halo-color': '#fff', 'text-halo-width': 2 }
  })
}
