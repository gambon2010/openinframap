// The look of the roads, railways, trams and borders (modules/roads), the same at
// each zoom over the map and over imagery, in two looks: `{ light, bold }`. Light:
// over the map while their Data layers entry is unticked, white roads with a grey
// edge. Bold, the entry ticked: pale colours vanish on imagery's fields and bare
// ground, so the big roads are saturated, lighter than the power lines (the 52 kV
// olive and 132 kV dark orange stay told apart), every road with a dark edge.

/** A value in each look. */
export interface Looks<T> {
  light: T
  bold: T
}

const WHITE = 'hsl(0, 0%, 100%)'

/** Motorways: bright orange. */
export const HIGHWAY_COLOUR: Looks<string> = { light: WHITE, bold: 'hsl(30, 100%, 60%)' }
/** Trunk roads (voies express, 2×2 roads built like motorways): amber, a little
 * narrower than motorways. */
export const TRUNK_COLOUR: Looks<string> = { light: WHITE, bold: 'hsl(42, 100%, 60%)' }
/** Primary roads and slip roads: bright yellow. */
export const MAJOR_COLOUR: Looks<string> = { light: WHITE, bold: 'hsl(52, 100%, 66%)' }
/** Secondary roads: pale yellow; tertiary: white. Each step down paler. */
export const SECONDARY_COLOUR: Looks<string> = { light: WHITE, bold: 'hsl(55, 90%, 80%)' }
export const TERTIARY_COLOUR: Looks<string> = { light: WHITE, bold: WHITE }
/** Smaller roads and service roads: white, bold a little see-through. */
export const MINOR_COLOUR: Looks<string> = { light: WHITE, bold: WHITE }
export const MINOR_OPACITY: Looks<number> = { light: 1, bold: 0.8 }
/** Footpaths and tracks (dashed): a mid grey, bold see-through white. */
export const PATH_COLOUR: Looks<string> = { light: 'hsl(240, 4%, 66%)', bold: WHITE }
export const SMALLEST_OPACITY: Looks<number> = { light: 1, bold: 0.6 }
export const PATH_DASHES = [3, 1]

/** Small roads, service roads and paths (from zoom 12, paths 13: the zoomed out
 * tiles) look the same at every zoom, only thinner zoomed out; their edge grows from a
 * hairline here to its full width here, so they never turn into dark lines. */
export const SMALL_EDGE_FROM_ZOOM = 12
export const SMALL_EDGE_FULL_ZOOM = 15
export const SMALL_EDGE_HAIRLINE = 0.25

/** The edge on each side of every road: grey, bold dark, so roads read on fields,
 * roofs and woods alike. */
export const EDGE_COLOUR: Looks<string> = { light: 'hsl(240, 5%, 74%)', bold: 'hsla(0, 0%, 5%, 0.85)' }
export const EDGE_WIDTH: Looks<number> = { light: 1, bold: 1.5 }

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
export const RAIL_MIN_WIDTH = { main: 4, branch: 3, minor: 2, service: 1.5 }

/** Tunnels: the line in its colour, see-through (this share of its opacity), without
 * an edge: the ground shows through, as under the road. (Dashes clashed where two
 * tunnels run side by side; dots read poorly.) */
export const TUNNEL_OPACITY = 0.55

/** Railways: a grey line with white dashes (bold black), with an outline. */
export const RAIL_COLOUR: Looks<string> = { light: 'hsl(240, 3%, 55%)', bold: 'hsl(240, 6%, 18%)' }
export const RAIL_DASH_COLOUR = 'hsl(0, 0%, 100%)'
export const RAIL_DASHES = [3, 3]
/** Its outline: grey, bold near black (white ones turned bundles of lines white). */
export const RAIL_EDGE_COLOUR: Looks<string> = { light: 'hsl(240, 5%, 62%)', bold: 'hsl(240, 6%, 12%)' }
/** Trams and metro: a plain line, pale pink (bold: in its line's colour, pink
 * without one, a colour no power line has), narrower than railways. */
export const TRAM_COLOUR: Looks<string> = { light: 'hsl(335, 35%, 60%)', bold: 'hsl(335, 85%, 68%)' }
export const TRAM_WIDTH_SCALE = 0.9
/** From this zoom, trams and metro are LOOM's lanes (lane-layers.ts); a plain line
 * further out. */
export const LANES_FROM = 12
export const TRAM_MIN_WIDTH = 2.5
/** Borders over imagery (over the map, the map's own): red dashes on a dark edge (the
 * same in both looks). */
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
