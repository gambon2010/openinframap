// Fork: My layers' list (outliner/index.ts): its filter chips, how many items a long
// layer shows first, the export formats, the groups of a layer's items.
import type { Format } from '../../io/formats.ts'
import type { Filter, ItemGroup } from './types.ts'

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

/** The groups, in their order (by side: friendly, hostile, others), with their names. */
export const ITEM_GROUPS: [ItemGroup, string][] = [
  ['friendly-units', 'Friendly units'],
  ['friendly-graphics', 'Friendly graphics'],
  ['hostile-units', 'Hostile units'],
  ['hostile-graphics', 'Hostile graphics'],
  ['other-units', 'Neutral and unknown units'],
  ['other-graphics', 'Other graphics'],
  ['measurements', 'Measurements'],
  ['drawings', 'Drawings and markers'],
  ['pictures', 'Pictures'],
  ['copies', 'Copies of map features']
]
