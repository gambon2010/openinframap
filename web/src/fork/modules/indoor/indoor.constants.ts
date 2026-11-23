// The interiors' look and layers (modules/indoor). Their ids start with the
// buildings' prefix (INTERIOR_PREFIX): the Buildings entry of the layer switcher shows
// and hides them.
import { INTERIOR_PREFIX } from '../../core/buildings.ts'

/** Tegola's indoor map (tegola/layers.fork.yml), from zoom 13 (the tint). */
export const INDOOR_SOURCE = 'indoor'
export const INDOOR_MIN_ZOOM = 13
/** Tegola makes tiles to zoom 17, as for every other map (style.ts); the map
 * stretches them past it (a pixel is about a metre there: room enough for rooms). */
export const INDOOR_MAX_ZOOM = 17

export const TINT_LAYER = `${INTERIOR_PREFIX}tint`
export const TINT_OUTLINE_LAYER = `${INTERIOR_PREFIX}tint_outline`
/** Underground places outside any building: their own tint, clicked for their details. */
export const PLACE_LAYER = `${INTERIOR_PREFIX}place`
export const PLACE_OUTLINE_LAYER = `${INTERIOR_PREFIX}place_outline`
/** Under a floor shown: the building filled, the map under it hidden. */
export const COVER_LAYER = `${INTERIOR_PREFIX}cover`
export const AREA_LAYER = `${INTERIOR_PREFIX}area`
export const AREA_OUTLINE_LAYER = `${INTERIOR_PREFIX}area_outline`
export const LINE_LAYER = `${INTERIOR_PREFIX}line`
export const LABEL_LAYER = `${INTERIOR_PREFIX}label`
/** The layers a chosen floor shows. */
export const FLOOR_LAYERS = [AREA_LAYER, AREA_OUTLINE_LAYER, LINE_LAYER, LABEL_LAYER]

/** What has a floor plan: violet over the building, outlined, apart from the roofs'
 * brown and the selection's yellow (docs/STYLE.md); underground places dashed. */
export const TINT_COLOUR = 'hsl(270, 60%, 50%)'
export const TINT_OPACITY = 0.3
export const TINT_OUTLINE_WIDTH = 1.5
export const PLACE_DASHES: [number, number] = [3, 2]
/** Under a floor shown: the map's light ground, opaque. */
export const COVER_COLOUR = 'hsl(40, 15%, 96%)'
/** A floor: rooms in the panels' light grey, corridors and open areas lighter, walls
 * and outlines dark grey. */
export const ROOM_COLOUR = 'hsl(35, 20%, 93%)'
export const OPEN_COLOUR = 'hsl(0, 0%, 98%)'
export const WALL_COLOUR = 'hsl(0, 0%, 30%)'

/** The tint just under the buildings' outlines (-10). */
export const TINT_ZORDER = -10.05
/** A floor shown (its cover, rooms, names) over everything else, labels (to 311) and
 * sites' icons (to 591) too: inside the building, only the plan shows. */
export const FLOOR_ZORDER = 600
