// The look of roads, railways and borders (modules/roads). Which ones show at each
// zoom and how wide is the same over the map and over imagery; colours differ:
// `{ map, imagery }`. Over the map, the high contrast palette's (white roads with a
// grey edge). Over imagery pale colours vanish on fields and bare ground, so the big
// roads are saturated, and lighter than the power lines (the 52 kV olive and 132 kV
// dark orange stay told apart), and every road has a dark edge.

/** A value over the map, and over imagery. */
export interface Both<T> {
  map: T
  imagery: T
}

/** Motorways: white on the map, bright orange over imagery. */
export const HIGHWAY_COLOUR: Both<string> = { map: 'hsl(0, 0%, 100%)', imagery: 'hsl(30, 100%, 60%)' }
/** Main roads and slip roads: bright yellow over imagery. */
export const MAJOR_COLOUR: Both<string> = { map: 'hsl(0, 0%, 100%)', imagery: 'hsl(52, 100%, 66%)' }
/** Smaller roads and service roads: white, a little see-through over imagery. */
export const MINOR_COLOUR: Both<string> = { map: 'hsl(0, 0%, 100%)', imagery: 'hsl(0, 0%, 100%)' }
export const MINOR_OPACITY: Both<number> = { map: 1, imagery: 0.8 }
/** Footpaths and tracks (dashed): a mid grey on the map, see-through white over imagery. */
export const PATH_COLOUR: Both<string> = { map: 'hsl(240, 4%, 66%)', imagery: 'hsl(0, 0%, 100%)' }
export const SMALLEST_OPACITY: Both<number> = { map: 1, imagery: 0.6 }
export const PATH_DASHES = [3, 1]

/** Small roads, service roads and paths: at their size from this zoom (the background
 * map has all of them from here), a thin line before it. */
export const SMALL_ROADS_FROM_ZOOM = 14
export const SMALL_ROADS_ZOOMED_OUT_COLOUR: Both<string> = {
  map: 'hsl(240, 4%, 72%)',
  imagery: 'hsla(0, 0%, 5%, 0.7)'
}
export const SMALL_ROADS_ZOOMED_OUT_WIDTH = 1

/** The edge on each side of every road: grey on the map; dark over imagery, so roads
 * read on fields, roofs and woods alike. */
export const EDGE_COLOUR: Both<string> = { map: 'hsl(240, 5%, 74%)', imagery: 'hsla(0, 0%, 5%, 0.85)' }
export const EDGE_WIDTH: Both<number> = { map: 1, imagery: 1.5 }

/** Roads a little narrower than the background map's (its widths make wide bands zoomed
 * in); railways keep theirs. */
export const ROAD_WIDTH_SCALE = 0.75
/** Each road's width never under these (pixels): the map's go down to nothing
 * zoomed out. */
export const HIGHWAY_MIN_WIDTH = 3
export const MAJOR_MIN_WIDTH = 0.75
export const LINK_MIN_WIDTH = 0.75
export const SMALL_ROAD_MIN_WIDTH = 0.75
export const RAIL_MIN_WIDTH = 2.5

/** Tunnels: the road dashed on a dashed edge (in road widths: the minimum widths keep
 * them visible zoomed out). */
export const TUNNEL_DASHES = [2, 1.5]
export const TUNNEL_EDGE_DASHES = [2, 2]

/** Railways: a line with white dashes (grey on the map, black over imagery), with a
 * light edge to part it from dark ground. */
export const RAIL_COLOUR: Both<string> = { map: 'hsl(240, 3%, 55%)', imagery: 'hsl(240, 6%, 18%)' }
export const RAIL_DASH_COLOUR = 'hsl(0, 0%, 100%)'
export const RAIL_DASHES = [3, 3]
export const RAIL_EDGE_COLOUR = 'hsla(0, 0%, 100%, 0.55)'
/** The railways drawn (the background map's kind_detail): lines in use, not their remains. */
export const RAILWAYS = [
  'rail',
  'light_rail',
  'narrow_gauge',
  'subway',
  'tram',
  'funicular',
  'monorail',
  'preserved'
]

/** Borders: red dashes, on a dark edge over imagery. */
export const BORDER_COLOUR: Both<string> = { map: 'hsl(0, 30%, 62%)', imagery: 'hsl(0, 90%, 62%)' }
export const BORDER_EDGE_COLOUR: Both<string> = {
  map: 'hsla(0, 0%, 0%, 0)',
  imagery: 'hsla(0, 0%, 5%, 0.85)'
}

/** Zoomed in, imagery shows the roads itself: over it the lines fade, from full here... */
export const FADE_FROM_ZOOM = 16
/** ...to this share of their strength here. */
export const FADE_TO_ZOOM = 18
export const FADED = 0.55

/** Street names over imagery: white on a dark halo. */
export const NAME_COLOUR = 'hsl(0, 0%, 100%)'
export const NAME_HALO_COLOUR = 'hsla(0, 0%, 0%, 0.75)'
export const NAME_HALO_WIDTH = 1.5
