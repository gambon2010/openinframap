// Fork: an item's card (editor/index.ts): its echelon marks, main identities and
// conditions.

// Echelons as their marks above the frame.
export const ECHELON_MARKS: [string, string, string][] = [
  ['-', '–', 'None'],
  ['A', 'ø', 'Team / crew'],
  ['B', '•', 'Squad'],
  ['C', '••', 'Section'],
  ['D', '•••', 'Platoon'],
  ['E', '|', 'Company'],
  ['F', '||', 'Battalion'],
  ['G', '|||', 'Regiment'],
  ['H', 'X', 'Brigade'],
  ['I', 'XX', 'Division'],
  ['J', 'XXX', 'Corps'],
  ['K', 'XXXX', 'Army']
]

export const MAIN_IDENTITIES = ['F', 'H', 'N', 'U']

export const CONDITIONS: [string, string][] = [
  ['C', 'Fully capable'],
  ['D', 'Damaged'],
  ['X', 'Destroyed'],
  ['F', 'Full to capacity']
]
