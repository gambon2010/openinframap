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
export const AREA_LAYER = `${INTERIOR_PREFIX}area`
export const AREA_OUTLINE_LAYER = `${INTERIOR_PREFIX}area_outline`
export const LINE_LAYER = `${INTERIOR_PREFIX}line`
export const POINT_LAYER = `${INTERIOR_PREFIX}point`
export const LABEL_LAYER = `${INTERIOR_PREFIX}label`
/** The layers a chosen floor shows. */
export const FLOOR_LAYERS = [AREA_LAYER, AREA_OUTLINE_LAYER, LINE_LAYER, POINT_LAYER, LABEL_LAYER]

/** Buildings with an interior: a light violet over the building, apart from the
 * roofs' brown and the selection's yellow (docs/STYLE.md). */
export const TINT_COLOUR = 'hsl(265, 45%, 62%)'
export const TINT_OPACITY = 0.14
/** A floor: rooms in the panels' light grey, corridors and open areas lighter, walls
 * and outlines dark grey, what stands inside a dark dot. */
export const ROOM_COLOUR = 'hsl(35, 20%, 93%)'
export const OPEN_COLOUR = 'hsl(0, 0%, 98%)'
export const WALL_COLOUR = 'hsl(0, 0%, 30%)'
export const POINT_COLOUR = 'hsl(0, 0%, 25%)'

/** Over the buildings (-10, their 3D -9.9), under the building numbers (-9.8). */
export const TINT_ZORDER = -10.05
export const FLOOR_ZORDER = -9.85
