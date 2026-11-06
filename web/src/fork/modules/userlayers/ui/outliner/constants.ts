// Fork: My layers' list (outliner/index.ts): its filter chips, how many items a long
// layer shows first, the export formats.
import type { Format } from '../../io/formats.ts'
import type { Filter } from './types.ts'

export const FILTERS: [Filter, string][] = [
  ['hostile', 'Hostile'],
  ['friend', 'Friend'],
  ['planned', 'Planned'],
  ['units', 'Units'],
  ['graphics', 'Graphics'],
  ['pictures', 'Pictures']
]

// A layer shows this many items at first (a big import would make every change slow).
export const ITEMS_SHOWN = 200

export const FORMATS: [Format, string][] = [
  ['geojson', 'GeoJSON'],
  ['kml', 'KML (Google Earth)'],
  ['gpx', 'GPX (GPS)']
]
