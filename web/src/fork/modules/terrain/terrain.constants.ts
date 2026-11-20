// Fork: the terrain's tiles and the hill shading's look (docs/STYLE.md, "Hill shading").

/** The map source of the terrain's elevations (hill shading; the 3D relief later). */
export const TERRAIN_SOURCE = 'terrain'
/** Mapterhorn's tiles: Terrarium encoded, 512 pixels, to zoom 13 (6.6 m in France;
 * scripts/offline_maps/terrain.py MAX_ZOOM). */
export const TERRAIN_MAX_ZOOM = 13
export const TERRAIN_TILE_SIZE = 512

/** Every terrain layer's id starts with this (the layer switcher's prefixes too). */
export const TERRAIN_PREFIX = 'terrain_'
export const HILLSHADE_LAYER = `${TERRAIN_PREFIX}hillshade`

/** Data layers entries: letters never used before (they're in map addresses). */
export const HILLSHADE_SWITCHER_ID = 'D'

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
