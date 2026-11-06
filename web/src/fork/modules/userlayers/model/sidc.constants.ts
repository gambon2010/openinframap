// Fork: symbol codes (2525C) (sidc.ts): its constants and tables.

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

/** Status, position 4: present / planned, or the operational condition. */
export const STATUSES: [string, string][] = [
  ['P', 'Present'],
  ['A', 'Planned'],
  ['C', 'Present: fully capable'],
  ['D', 'Present: damaged'],
  ['X', 'Present: destroyed'],
  ['F', 'Present: full to capacity']
]

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
export const UNIT_MODIFIERS: Record<string, { hq: boolean; taskForce: boolean; feint: boolean }> = {
  '-': { hq: false, taskForce: false, feint: false },
  A: { hq: true, taskForce: false, feint: false },
  B: { hq: true, taskForce: true, feint: false },
  C: { hq: true, taskForce: false, feint: true },
  D: { hq: true, taskForce: true, feint: true },
  E: { hq: false, taskForce: true, feint: false },
  F: { hq: false, taskForce: false, feint: true },
  G: { hq: false, taskForce: true, feint: true }
}
