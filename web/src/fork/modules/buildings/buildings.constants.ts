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

/** Building numbers (numbers.ts): their layer's id (the layer switcher's prefix), and
 * the zoom they're asked for from (a few streets: the backend numbers whole communes,
 * a handful per view at most). */
export const NUMBERS_LAYER = 'building_numbers'
export const NUMBERS_FROM_ZOOM = 16
/** How the numbers are written, kept in this browser: "full" or "number". */
export const NUMBERS_LABELS_KEY = 'oim-building-number-labels'
/** Over the buildings (-10), under the infrastructure. */
export const NUMBERS_ZORDER = -9.8
