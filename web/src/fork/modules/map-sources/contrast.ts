// Fork: towns stand out from the fields. Upstream's background style (style/
// style_base.ts) draws land and built-up areas (towns, industry, farmyards...) at
// the same lightness from zoom 6 on (93%), told apart only by a faint tint, so
// where a town stops is hard to see while the roads are clear. Built-up areas are
// drawn a little darker instead: the same tint, 88% from zoom 6 (roads stay as
// they are: major ones darker, minor ones lighter than towns).
import type { ExpressionSpecification, Map } from 'maplibre-gl'

/** The built-up areas' colour: upstream's hue and tint, a little darker. */
export const BUILT_UP: ExpressionSpecification = [
  'interpolate-lab',
  ['linear'],
  ['zoom'],
  2,
  'hsl(245, 6%, 82%)',
  6,
  'hsl(245, 8%, 88%)'
]

/** Upstream's layers drawing built-up areas (by land use, and as land cover zoomed out). */
const LAYERS = ['osm_landuse_urban', 'osm_landcover_urban']

export function townContrast(map: Map) {
  const apply = () => {
    for (const id of LAYERS) if (map.getLayer(id)) map.setPaintProperty(id, 'fill-color', BUILT_UP)
  }
  map.on('style.load', apply)
  if (map.isStyleLoaded()) apply()
}
