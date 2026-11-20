// Fork: the terrain's tiles, and the hill shading's and contour lines' looks
// (docs/STYLE.md, "Hill shading", "Contour lines").

/** Mapterhorn's tiles: Terrarium encoded, 512 pixels, to zoom 13 (6.6 m in France;
 * scripts/offline_maps/terrain.py MAX_ZOOM). */
export const TERRAIN_MAX_ZOOM = 13
export const TERRAIN_TILE_SIZE = 512

/** Every terrain layer's id starts with this (the layer switcher's prefixes too). */
export const TERRAIN_PREFIX = 'terrain_'
export const HILLSHADE_LAYER = `${TERRAIN_PREFIX}hillshade`
/** Every contour layer's id starts with this. */
export const CONTOURS_PREFIX = `${TERRAIN_PREFIX}contours`

/** Data layers entries: letters never used before (they're in map addresses). */
export const HILLSHADE_SWITCHER_ID = 'D'
export const CONTOURS_SWITCHER_ID = 'C'

/** The backend's contour tiles (web-backend/src/fork/terrain/contours.py). */
export const CONTOURS_SOURCE = 'terrain_contours'
export const CONTOURS_SOURCE_LAYER = 'contours'
export const CONTOURS_MIN_ZOOM = 9
export const CONTOURS_MAX_ZOOM = 16

/** Contour browns (the USGS's US Topo specifications): the lines, and the darker
 * heights written on index contours; lighter over imagery. */
export const CONTOUR_COLOUR = { map: '#b38659', imagery: '#e0b07a' }
export const CONTOUR_LABEL_COLOUR = { map: '#834225', imagery: '#f0c890' }
/** Line widths (pixels) at zooms 9 and 16: intermediate (and supplementary) and
 * index contours. */
export const INTERMEDIATE_WIDTH: [number, number] = [0.5, 0.9]
export const INDEX_WIDTH: [number, number] = [1, 1.8]
/** Supplementary contours' dashes, in line widths (dash, gap). */
export const SUPPLEMENTARY_DASHES = [4, 3]
/** Depression ticks: drawn as a wide dashed line beside the contour, on its downhill
 * side (the backend puts that side on the right): the width is the ticks' length,
 * the dashes (in widths) their thickness and spacing. */
export const TICK_LENGTH = 4
export const TICK_DASHES = [0.3, 2.5]

/** Light from the north-west, as on paper maps, blended with three more
 * directions (MapLibre's multidirectional method: slopes facing away from the
 * main light don't go flat). Degrees clockwise from north. */
export const LIGHT_DIRECTIONS = [315, 270, 0, 225]
/** How strong the shading is (0 to 1): over the map, and fainter over imagery
 * (photos have their own shadows). */
export const STRENGTH = { map: 0.45, imagery: 0.25 }
/** Warm grey shadows, faint white highlights, see-through (the map shows under). */
export const SHADOW_COLOUR = 'rgba(70, 58, 45, 0.55)'
export const HIGHLIGHT_COLOUR = 'rgba(255, 255, 255, 0.25)'
