// The buildings' look (modules/buildings).

/** Outlines: dark, over the map and over imagery (where the roof under them is light). */
export const OUTLINE = 'hsl(0, 0%, 15%)'

/** Over imagery, a building is filled like a roof: a muted tile colour, a little
 * see-through so the photo still shows. Over the map: no fill (the map has its own). */
export const ROOF_COLOUR = 'hsl(20, 22%, 74%)'
export const ROOF_OPACITY = { map: 0, imagery: 0.45 }

/** And casts a small shadow down and right on screen, lifting it off the photo. */
export const SHADOW_COLOUR = 'hsl(0, 0%, 0%)'
export const SHADOW_OPACITY = { map: 0, imagery: 0.4 }
export const SHADOW_OFFSET: [number, number] = [2, 2]
