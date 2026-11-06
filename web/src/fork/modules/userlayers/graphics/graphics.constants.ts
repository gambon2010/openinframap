// Fork: tactical graphics (graphics.ts): its constants and tables.

/**
 * Graphics 2525C doesn't have but 2525D does, under a 2525C-style code of ours:
 * the position area for artillery (PAA) drawn point by point (2525C: only a rectangle
 * or a circle, which need a width or radius the tool doesn't ask for).
 */
export const BEYOND_C: Record<string, { sibling: string; entity: string }> = {
  // As the fire support area, irregular (G*F*ACSI); 2525D entity 240503.
  'G*F*ACPI': { sibling: 'G*F*ACSI', entity: '240503' }
}

// A flat approximation around a point (equirectangular), fine at an arrow's scale.
// Arrows' widths are worked out with it and saved: keep it as it is (not the sphere
// of measure/geo.ts), or saved arrows and new ones would differ.
/** Metres in a degree of longitude at the equator (times cos(latitude) elsewhere). */
export const METRES_PER_DEGREE_LON_AT_EQUATOR = 111_320

/** Metres in a degree of latitude (its average, near 45°). */
export const METRES_PER_DEGREE_LAT = 110_540

/** A screen pixel's size in the OGC's standard (0.28 mm), metres. */
export const OGC_PIXEL_M = 0.00028

/**
 * Three-point graphics drawn square: a base between two points and the third on the
 * perpendicular through its middle (Block, Contain, Clear, Breach, Bypass...; Disrupt:
 * through one end): where the third point goes, which two make the base. 2525C codes, affiliation and status
 * left out (positions 1 and 3). Others take their points as they are.
 */
export const SQUARE: Record<string, { base: [number, number]; free: number; through?: number }> = {}
for (const code of [
  'G*T*B', // Block
  'G*M*OEB', // Block (obstacle effect)
  'G*T*P', // Penetrate
  'G*T*J', // Contain
  'G*T*X', // Clear
  'G*T*H', // Breach
  'G*T*Y', // Bypass
  'G*M*BDE', // Bypass easy
  'G*M*BDD', // Bypass difficult
  'G*M*BDI', // Bypass impossible
  'G*T*C' // Canalize
])
  SQUARE[code] = { base: [0, 1], free: 2 }
// Disrupt: its arrows run along the line from one of the base's ends to the third
// point (the task: from the second; the obstacle effect: from the first).
SQUARE['G*T*T'] = { base: [0, 1], free: 2, through: 1 }
SQUARE['G*M*OED'] = { base: [0, 1], free: 2, through: 0 }
for (const code of [
  'G*G*SLA', // Ambush: the arc's ends, the arrow's tip
  'G*G*OAF' // Attack by fire position: the base's ends, the arrow's tip
])
  SQUARE[code] = { base: [1, 2], free: 0 }
