// Fork: a line of sight's answer in words (its card and its split screen).
import { t } from '../../../core/i18n.ts'
import { formatDistance } from '../../../core/earth.ts'
import type { SightResult } from './sight.ts'

/** "Seen (12 m clear)", "Hidden by trees 6.38 km away (18 m above the line)": the
 * margin is how far the eye's line to the target passes over the highest thing
 * between, or how far that rises above it. */
export function sightVerdict(result: SightResult): string {
  const margin = result.margin === null ? '' : Math.abs(Math.round(result.margin)).toString()
  if (result.target_seen)
    return margin
      ? t('userlayers.sight-seen-margin', 'Seen ({{margin}} m clear)', { margin })
      : t('userlayers.sight-seen', 'Seen')
  const distance = formatDistance(result.blocked_at ?? 0)
  const by = {
    ground: t('userlayers.sight-by-ground', 'Hidden by the ground {{distance}} away', { distance }),
    building: t('userlayers.sight-by-building', 'Hidden by a building {{distance}} away', { distance }),
    trees: t('userlayers.sight-by-trees', 'Hidden by trees {{distance}} away', { distance })
  }[result.blocked_by ?? 'ground']
  return margin
    ? `${by} ${t('userlayers.sight-above-line', '({{margin}} m above the line)', { margin })}`
    : by
}

/** The map's mark where the target is first hidden: "Trees 20 m", "Building 15 m",
 * "Ground". */
export function sightBlockLabel(result: SightResult): string {
  const point = result.profile.reduce((best, p) =>
    Math.abs(p[0] - (result.blocked_at ?? 0)) < Math.abs(best[0] - (result.blocked_at ?? 0)) ? p : best
  )
  const height = Math.round(point[3])
  if (result.blocked_by === 'trees') return t('userlayers.sight-mark-trees', 'Trees {{height}} m', { height })
  if (result.blocked_by === 'building')
    return t('userlayers.sight-mark-building', 'Building {{height}} m', { height })
  return t('userlayers.sight-mark-ground', 'Ground')
}
