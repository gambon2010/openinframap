// Fork: graphics that are two versions of one thing (docs/SPECIFICATIONS 9.27): a
// switch on the card between its versions (both are in the picker; how to list them
// is in the backlog, 9.29).
// - Block, Disrupt, Fix: the task (black: what a unit does) or the obstacle (green,
//   the standard's colour for friendly obstacles: what an obstacle does; the
//   standard's "obstacle effect").
// - Main attack, Supporting attack, Aviation: an axis of advance (a wide arrow, path
//   and width) or a direction of attack (a thin arrow along the same path).
// Both versions take the same points (an arrow: its path, tail to tip), so switching
// keeps the drawing.
import { t } from '../../../core/i18n.ts'
import { graphicKey } from './labels.ts'

export interface Variants {
  /** The two versions' keys (graphicKey): the first is the one in the picker. */
  keys: [string, string]
  /** What each is called on the card's switch. */
  labels: () => [string, string]
  /** Arrows: the first is an axis of advance (path and width). */
  arrow?: boolean
}

const taskOrObstacle = (): [string, string] => [
  t('userlayers.variant.task', 'Task'),
  t('userlayers.variant.obstacle', 'Obstacle')
]
const axisOrDirection = (): [string, string] => [
  t('userlayers.variant.axis', 'Axis of advance (wide)'),
  t('userlayers.variant.direction', 'Direction of attack (thin)')
]

export const VARIANTS: Variants[] = [
  { keys: ['G*T*B', 'G*M*OEB'], labels: taskOrObstacle },
  { keys: ['G*T*T', 'G*M*OED'], labels: taskOrObstacle },
  { keys: ['G*T*F', 'G*M*OEF'], labels: taskOrObstacle },
  { keys: ['G*G*OLAGM', 'G*G*OLKGM'], labels: axisOrDirection, arrow: true },
  { keys: ['G*G*OLAGS', 'G*G*OLKGS'], labels: axisOrDirection, arrow: true },
  { keys: ['G*G*OLAV', 'G*G*OLKA'], labels: axisOrDirection, arrow: true }
]

/** A graphic's versions, and which one it is (null: it has none). */
export function variantsOf(sidc: string): { variants: Variants; index: 0 | 1 } | null {
  const key = graphicKey(sidc)
  for (const variants of VARIANTS) {
    const index = variants.keys.indexOf(key)
    if (index >= 0) return { variants, index: index as 0 | 1 }
  }
  return null
}

/** A code as another graphic (a key), keeping its affiliation, status and the rest. */
export function withKey(sidc: string, key: string): string {
  const code = key.replace(/\*/g, '').split('')
  // The key is the code with positions 2 and 4 (affiliation, status) as '*'.
  const out = sidc.padEnd(15, '-').split('')
  out[0] = code[0]
  out[2] = code[1]
  const rest = key.slice(4)
  for (let i = 0; i < 6; i++) out[4 + i] = rest[i] ?? '-'
  return out.join('')
}

/**
 * Directions of attack (thin arrows): the renderer wants the tip first, we keep the
 * path tail to tip (like the axes, and as it's drawn): reversed for the renderer.
 */
const DIRECTIONS = new Set(['G*G*OLKGM', 'G*G*OLKGS', 'G*G*OLKA', 'G*G*PF'])

export function isDirection(sidc: string | undefined): boolean {
  return !!sidc && DIRECTIONS.has(graphicKey(sidc))
}
