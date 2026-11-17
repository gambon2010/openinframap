// Fork: groups of features drawn as one point with a count (critical sites below
// zoom 14: site_points in schema/fork/sites.sql). A group says how many of each kind
// it holds (`kinds`: ",fuel:12,fuel_depot:3,"), and its layer says, in its metadata,
// which key icon each kind has (COUNTS: kind → icon). When the key hides kinds
// (feature-hider.ts), the count shown is of the other kinds, sized by it, and a group
// of hidden kinds only isn't drawn.
import type { ExpressionSpecification } from 'maplibre-gl'

/** A layer's metadata key: its kinds' key icons (kind → icon). */
export const COUNTS = 'oim:counts'
export type Counts = Record<string, string>

/** The fields a group layer's style reads: the count (as given, for every kind), and
 * as shown ("1.2k"). Replaced by the count of the kinds shown. */
const COUNT: ExpressionSpecification = ['get', 'count']
const COUNT_LABEL: ExpressionSpecification = ['get', 'count_label']
const KINDS: ExpressionSpecification = ['get', 'kinds']

export function countsOf(layer: { metadata?: unknown }): Counts | undefined {
  const metadata = layer.metadata as Record<string, unknown> | undefined
  return metadata?.[COUNTS] as Counts | undefined
}

/** How many of a kind a group holds (",fuel:12," → 12; none: 0). */
export function kindCount(kind: string): ExpressionSpecification {
  const key = `,${kind}:`
  const from: ExpressionSpecification = ['+', ['var', 'at'], key.length]
  return [
    'let',
    'at',
    ['index-of', key, ['coalesce', KINDS, '']],
    [
      'case',
      ['<', ['var', 'at'], 0],
      0,
      ['to-number', ['slice', KINDS, from, ['index-of', ',', KINDS, from]]]
    ]
  ]
}

/** How many a group holds of the kinds whose icon isn't hidden. */
export function shownCount(counts: Counts, hiddenIcons: Set<string>): ExpressionSpecification {
  const shown = Object.entries(counts)
    .filter(([, icon]) => !hiddenIcons.has(icon))
    .map(([kind]) => kindCount(kind))
  return ['+', 0, 0, ...shown]
}

/** A count as shown: 950, 1.2k, 12k (site_points's count_label). */
export function countLabel(count: ExpressionSpecification): ExpressionSpecification {
  const thousands: ExpressionSpecification = ['/', count, 1000]
  return [
    'case',
    ['<', count, 1000],
    ['to-string', count],
    ['<', count, 10000],
    ['concat', ['number-format', thousands, { 'max-fraction-digits': 1 }], 'k'],
    ['concat', ['to-string', ['round', thousands]], 'k']
  ]
}

/** A style value with the count read from the kinds shown (`count`). */
export function withCount(value: unknown, count: ExpressionSpecification): unknown {
  const label = countLabel(count)
  const swap = (v: unknown): unknown => {
    const text = JSON.stringify(v)
    if (text === JSON.stringify(COUNT)) return count
    if (text === JSON.stringify(COUNT_LABEL)) return label
    return Array.isArray(v) ? v.map(swap) : v
  }
  return swap(value)
}

/** Whether a group layer counts any of these hidden icons. */
export function countsHidden(counts: Counts, hiddenIcons: Set<string>): boolean {
  return Object.values(counts).some((icon) => hiddenIcons.has(icon))
}
