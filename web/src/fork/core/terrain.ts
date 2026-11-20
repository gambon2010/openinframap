// Fork: the terrain's map sources and the Hill shading entry, shared by
// modules/terrain (which adds them and draws the hill shading) and modules/view3d
// (the relief in the 3D view, which switches the shading on). Both read
// the backend's /terrain tiles; MapLibre draws hill shading and relief better from
// two sources than from one shared.

/** The elevations the hill shading is drawn from. */
export const TERRAIN_SOURCE = 'terrain'
/** The same elevations, for the 3D relief. */
export const RELIEF_SOURCE = 'terrain_relief'
/** The Hill shading entry in Data layers: a letter never used before (it's in map
 * addresses). */
export const HILLSHADE_SWITCHER_ID = 'D'
/** True heights in 3D (the owner's choice: no exaggeration). */
export const RELIEF_EXAGGERATION = 1
