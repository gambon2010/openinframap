// The look of roads, railways and borders over imagery ("satellite with roads",
// hybrid.ts). Pale colours vanish on fields and bare ground, so the big roads are
// saturated, and lighter than the power lines (the 52 kV olive and 132 kV dark
// orange stay told apart).

/** Motorways: bright orange. */
export const HIGHWAY_COLOUR = 'hsl(30, 100%, 60%)'
/** Main roads and slip roads: bright yellow. */
export const MAJOR_COLOUR = 'hsl(52, 100%, 66%)'
/** Smaller roads, service roads and paths: white, a little see-through. */
export const MINOR_COLOUR = 'hsl(0, 0%, 100%)'
export const MINOR_OPACITY = 0.8
export const SMALLEST_OPACITY = 0.6
/** Small roads, service roads and paths: at their size from this zoom (the background
 * map has all of them from here), a thin dark line before it. */
export const SMALL_ROADS_FROM_ZOOM = 14
export const SMALL_ROADS_ZOOMED_OUT_COLOUR = 'hsla(0, 0%, 5%, 0.7)'
export const SMALL_ROADS_ZOOMED_OUT_WIDTH = 1

/** The dark edge on each side of every road, so it reads on fields, roofs and woods alike. */
export const EDGE_COLOUR = 'hsla(0, 0%, 5%, 0.85)'
export const EDGE_WIDTH = 1.5

/** Tunnels: the road dashed, on a dashed edge, a little see-through (underground);
 * still strong enough to show over dark forest. */
export const TUNNEL_OPACITY = 0.75
export const TUNNEL_DASHES = [2, 1.5]
export const TUNNEL_EDGE_DASHES = [2, 2]

/** Railways: the classic black line with white dashes, a light edge to part it from dark ground. */
export const RAIL_COLOUR = 'hsl(240, 6%, 18%)'
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

/** Borders: red dashes on a dark edge. */
export const BORDER_COLOUR = 'hsl(0, 90%, 62%)'

/** Zoomed in the imagery shows the roads itself: the lines fade, from full here... */
export const FADE_FROM_ZOOM = 16
/** ...to this share of their strength here. */
export const FADE_TO_ZOOM = 18
export const FADED = 0.55

/** Street names over imagery: white on a dark halo. */
export const NAME_COLOUR = 'hsl(0, 0%, 100%)'
export const NAME_HALO_COLOUR = 'hsla(0, 0%, 0%, 0.75)'
export const NAME_HALO_WIDTH = 1.5
