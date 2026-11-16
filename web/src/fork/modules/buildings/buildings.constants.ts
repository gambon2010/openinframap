// The buildings' look (modules/buildings/look.ts).

/** Outlines: dark, over the map and over imagery (where the roof under them is light). */
export const OUTLINE = 'hsl(0, 0%, 15%)'
export const OUTLINE_OPACITY = 0.8

/** Over imagery, a building is filled like a roof: a muted tile colour, mostly
 * see-through so the photo still shows. Over the map: no fill (the map has its own). */
export const ROOF_COLOUR = 'hsl(20, 22%, 74%)'
export const ROOF_OPACITY = 0.3

/** And casts a small shadow down and right on screen, lifting it off the photo. */
export const SHADOW_COLOUR = 'hsl(0, 0%, 0%)'
export const SHADOW_OPACITY = 0.4
export const SHADOW_OFFSET: [number, number] = [2, 2]

/** In the 3D view: buildings raised to their height, in the roofs' colour. */
export const RAISED_OPACITY = 0.85
/** A building with no height in the map's data (most houses): about two storeys. */
export const DEFAULT_HEIGHT_M = 8
