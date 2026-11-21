// Fork: a military base's parts (parts.ts, schema/fork/site-parts.sql).
import type { ExpressionSpecification } from 'maplibre-gl'

/** Where a base's building and zone parts are drawn from (site-points.sql and
 * tegola/layers.fork.yml leave them out of the tiles before; a test checks they agree). */
export const PARTS_MIN_ZOOM = 15

/** A part drawn as a building or an outline, not as a site of its own (no icon, no
 * fill in its category's colour). */
export const NOT_A_SITE_OF_ITS_OWN: ExpressionSpecification = [
  'in',
  ['coalesce', ['get', 'part'], ''],
  ['literal', ['building', 'zone']]
]

/** A building part's roof and outline: as the background map's buildings, so they
 * read as buildings; the roof see-through over imagery (the photo's roof shows). */
export const PART_ROOF_COLOUR = 'hsl(30, 12%, 82%)'
export const PART_ROOF_OPACITY = { map: 0.9, imagery: 0.35 }
export const PART_OUTLINE_COLOUR = 'hsl(0, 0%, 15%)'
/** A building part raised in 3D: its height, or its floors at this height each, else
 * this one (a magazine, a barracks block). Metres. */
export const PART_DEFAULT_HEIGHT_M = 5
export const PART_LEVEL_HEIGHT_M = 3
/** A zone part's outline: thinner than a site's, dashed. */
export const PART_ZONE_WIDTH = 1
export const PART_ZONE_DASHES = [3, 2]
/** A part mapped as a point only (a bunker's node): a small disc. */
export const PART_POINT_RADIUS = 3.5
