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

/** Each identity as its frame: friends a blue rectangle, hostiles a red diamond,
 * neutrals a green square, the unknown yellow (MIL-STD-2525C's shapes and colours). */
export const IDENTITY_ICONS: Record<string, string> = {
  P: '🟨',
  U: '🟨',
  A: '🟦',
  F: '🟦',
  N: '🟩',
  S: '♦️',
  H: '♦️',
  J: '♦️',
  K: '♦️'
}

export const CONDITIONS: [string, string][] = [
  ['C', 'Fully capable'],
  ['D', 'Damaged'],
  ['X', 'Destroyed'],
  ['F', 'Full to capacity']
]
