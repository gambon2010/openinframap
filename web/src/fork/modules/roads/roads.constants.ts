// The look of the bold roads, railways, trams and borders (modules/roads), the same
// at each zoom over the map and over imagery. Bold: pale colours vanish on imagery's
// fields and bare ground, so the big roads are saturated, lighter than the power
// lines (the 52 kV olive and 132 kV dark orange stay told apart), every road with a
// dark edge. Over the map without them, the map's own light roads show
// (modules/map-sources/palette.ts).

/** Motorways: bright orange. */
export const HIGHWAY_COLOUR = 'hsl(30, 100%, 60%)'
/** Trunk roads (voies express, 2×2 roads built like motorways): amber, a little
 * narrower than motorways. */
export const TRUNK_COLOUR = 'hsl(42, 100%, 60%)'
/** Primary roads and slip roads: bright yellow. */
export const MAJOR_COLOUR = 'hsl(52, 100%, 66%)'
/** Secondary roads: pale yellow; tertiary: white. Each step down paler. */
export const SECONDARY_COLOUR = 'hsl(55, 90%, 80%)'
export const TERTIARY_COLOUR = 'hsl(0, 0%, 100%)'
/** Smaller roads and service roads: white, a little see-through. */
export const MINOR_COLOUR = 'hsl(0, 0%, 100%)'
export const MINOR_OPACITY = 0.8
/** Footpaths and tracks (dashed): see-through white. */
export const PATH_COLOUR = 'hsl(0, 0%, 100%)'
export const SMALLEST_OPACITY = 0.6
export const PATH_DASHES = [3, 1]

/** Small roads, service roads and paths (from zoom 12, paths 13: the zoomed out
 * tiles) look the same at every zoom, only thinner zoomed out; their edge grows from a
 * hairline here to its full width here, so they never turn into dark lines. */
export const SMALL_EDGE_FROM_ZOOM = 12
export const SMALL_EDGE_FULL_ZOOM = 15
export const SMALL_EDGE_HAIRLINE = 0.25

/** The edge on each side of every road: dark, so roads read on fields, roofs and
 * woods alike. */
export const EDGE_COLOUR = 'hsla(0, 0%, 5%, 0.85)'
export const EDGE_WIDTH = 1.5

/** Roads a little narrower than the background map's (its widths make wide bands zoomed
 * in); railways keep theirs. */
export const ROAD_WIDTH_SCALE = 0.75
/** Each road's width never under these (pixels): the map's go down to nothing
 * zoomed out. */
export const HIGHWAY_MIN_WIDTH = 3
export const TRUNK_MIN_WIDTH = 2.5
export const MAJOR_MIN_WIDTH = 0.75
export const LINK_MIN_WIDTH = 0.75
export const SMALL_ROAD_MIN_WIDTH = 0.75
/** Railways by rank (zoomed_railways.py): main lines like motorways, branch lines like
 * main roads (wide enough for their dashes to show). */
export const RAIL_MIN_WIDTH = { main: 3, branch: 2, minor: 1.5, service: 1 }

/** Tunnels: the road dashed on a dashed edge (in road widths: the minimum widths keep
 * them visible zoomed out). */
export const TUNNEL_DASHES = [2, 1.5]
export const TUNNEL_EDGE_DASHES = [2, 2]

/** Railways: a black line with white dashes, with a light edge to part it from dark
 * ground. */
export const RAIL_COLOUR = 'hsl(240, 6%, 18%)'
export const RAIL_DASH_COLOUR = 'hsl(0, 0%, 100%)'
export const RAIL_DASHES = [3, 3]
export const RAIL_EDGE_COLOUR = 'hsla(0, 0%, 100%, 0.55)'
/** Trams and metro: a plain line in its line's colour, pink without one (a colour no
 * power line has), narrower than railways. */
export const TRAM_COLOUR = 'hsl(335, 85%, 68%)'
export const TRAM_WIDTH_SCALE = 0.6
export const TRAM_MIN_WIDTH = 1.5
/** Borders over imagery (over the map, the map's own): red dashes on a dark edge. */
export const BORDER_COLOUR = 'hsl(0, 90%, 62%)'
export const BORDER_EDGE_COLOUR = 'hsla(0, 0%, 5%, 0.85)'

/** Zoomed in, imagery shows the roads itself: over it the lines fade, from full here... */
export const FADE_FROM_ZOOM = 16
/** ...to this share of their strength here. */
export const FADE_TO_ZOOM = 18
export const FADED = 0.55

/** Street names over imagery: white on a dark halo. */
export const NAME_COLOUR = 'hsl(0, 0%, 100%)'
export const NAME_HALO_COLOUR = 'hsla(0, 0%, 0%, 0.75)'
export const NAME_HALO_WIDTH = 1.5
