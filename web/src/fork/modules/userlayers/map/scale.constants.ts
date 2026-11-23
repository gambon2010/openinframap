// Fork: a layer's symbols drawn to scale (scale.ts): the scales offered, its limits
// and dot colours.

/** The map scales a layer's symbols can be drawn at (1:n), the usual ones of paper
 * maps, from a street plan to a regional map. */
export const SCALE_STEPS = [5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000]

/** Below a quarter of their size, they're drawn as dots. */
export const DOT_BELOW = 0.25

/** Zoomed in, they grow to 8 times their size at most (3 zoom levels). */
export const MOST_GROWTH = 8

/** The frames' fill colours (MIL-STD-2525C's light ones): friend cyan, hostile red,
 * neutral green, unknown yellow; their variants alike. */
export const IDENTITY_FILLS: Record<string, string> = {
  F: '#80e0ff',
  A: '#80e0ff',
  D: '#80e0ff',
  M: '#80e0ff',
  H: '#ff8080',
  S: '#ff8080',
  J: '#ff8080',
  K: '#ff8080',
  N: '#aaffaa',
  L: '#aaffaa',
  U: '#ffff80',
  P: '#ffff80',
  G: '#ffff80',
  W: '#ffff80'
}

/** The dots' radius (pixels). */
export const DOT_RADIUS = 4
