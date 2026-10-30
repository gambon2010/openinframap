// Fork: reading and changing the parts of a MIL-STD-2525C symbol code (SIDC, 15
// characters) that the details editor shows: standard identity, status, echelon,
// headquarters / task force / feint, mobility. Positions (0-based):
//   0 coding scheme, 1 standard identity, 2 dimension, 3 status, 4-9 function,
//   10-11 symbol modifiers (echelon, HQ...; mobility for equipment), 12-13 country,
//   14 order of battle.

export type SymbolKind = 'unit' | 'equipment' | 'installation' | 'activity' | 'graphic' | 'other'

/** What a code is, which decides the fields that apply to it. */
export function symbolKind(sidc: string): SymbolKind {
  const scheme = sidc[0]
  const dimension = sidc[2]
  const fn = sidc[4]
  if (scheme === 'G') return 'graphic'
  if (scheme === 'O') return 'activity'
  if (scheme === 'E') {
    if (dimension === 'F') return 'installation'
    if (dimension === 'I') return 'activity' // incidents
    return 'other'
  }
  if (scheme === 'S' && dimension === 'G') {
    if (fn === 'U') return 'unit'
    if (fn === 'E') return 'equipment'
    if (fn === 'I') return 'installation'
  }
  if (scheme === 'S' && dimension === 'F') return 'unit' // special operations forces
  if (scheme === 'S') return 'equipment' // air, sea, subsurface, space: platforms
  return 'other'
}

function setChar(sidc: string, index: number, char: string): string {
  const chars = sidc.padEnd(15, '-').split('')
  chars[index] = char
  return chars.join('')
}

export const IDENTITIES: [string, string][] = [
  ['P', 'Pending'],
  ['U', 'Unknown'],
  ['A', 'Assumed friend'],
  ['F', 'Friend'],
  ['N', 'Neutral'],
  ['S', 'Suspect'],
  ['H', 'Hostile'],
  ['J', 'Joker'],
  ['K', 'Faker']
]

export const identity = (sidc: string) => sidc[1]
export const withIdentity = (sidc: string, value: string) => setChar(sidc, 1, value)

/** Status, position 4: present / planned, or the operational condition. */
export const STATUSES: [string, string][] = [
  ['P', 'Present'],
  ['A', 'Planned'],
  ['C', 'Present: fully capable'],
  ['D', 'Present: damaged'],
  ['X', 'Present: destroyed'],
  ['F', 'Present: full to capacity']
]

export const status = (sidc: string) => sidc[3]
export const withStatus = (sidc: string, value: string) => setChar(sidc, 3, value)

export const ECHELONS: [string, string][] = [
  ['-', 'None'],
  ['A', 'Team / crew'],
  ['B', 'Squad'],
  ['C', 'Section'],
  ['D', 'Platoon / detachment'],
  ['E', 'Company / battery / troop'],
  ['F', 'Battalion / squadron'],
  ['G', 'Regiment / group'],
  ['H', 'Brigade'],
  ['I', 'Division'],
  ['J', 'Corps'],
  ['K', 'Army'],
  ['L', 'Army group / front'],
  ['M', 'Region']
]

// Position 11 for units: headquarters, task force and feint/dummy, combined.
const UNIT_MODIFIERS: Record<string, { hq: boolean; taskForce: boolean; feint: boolean }> = {
  '-': { hq: false, taskForce: false, feint: false },
  A: { hq: true, taskForce: false, feint: false },
  B: { hq: true, taskForce: true, feint: false },
  C: { hq: true, taskForce: false, feint: true },
  D: { hq: true, taskForce: true, feint: true },
  E: { hq: false, taskForce: true, feint: false },
  F: { hq: false, taskForce: false, feint: true },
  G: { hq: false, taskForce: true, feint: true }
}

export interface UnitModifiers {
  echelon: string
  hq: boolean
  taskForce: boolean
  feint: boolean
}

export function unitModifiers(sidc: string): UnitModifiers {
  const flags = UNIT_MODIFIERS[sidc[10]] ?? UNIT_MODIFIERS['-']
  const echelon = ECHELONS.some(([code]) => code === sidc[11]) ? sidc[11] : '-'
  return { echelon, ...flags }
}

export function withUnitModifiers(sidc: string, m: UnitModifiers): string {
  const entry = Object.entries(UNIT_MODIFIERS).find(
    ([, f]) => f.hq === m.hq && f.taskForce === m.taskForce && f.feint === m.feint
  )
  // No echelon and no flags: both characters are '-'.
  return setChar(setChar(sidc, 10, entry ? entry[0] : '-'), 11, m.echelon || '-')
}

/** Equipment mobility, positions 11-12 ("MO" wheeled...). */
export const MOBILITIES: [string, string][] = [
  ['--', 'None'],
  ['MO', 'Wheeled'],
  ['MP', 'Cross country'],
  ['MQ', 'Tracked'],
  ['MR', 'Wheeled and tracked'],
  ['MS', 'Towed'],
  ['MT', 'Rail'],
  ['MU', 'Over snow'],
  ['MV', 'Sled'],
  ['MW', 'Pack animals'],
  ['MX', 'Barge'],
  ['MY', 'Amphibious']
]

export function mobility(sidc: string): string {
  const value = sidc.slice(10, 12)
  return MOBILITIES.some(([code]) => code === value) ? value : '--'
}

export function withMobility(sidc: string, value: string): string {
  return setChar(setChar(sidc, 10, value[0]), 11, value[1])
}
