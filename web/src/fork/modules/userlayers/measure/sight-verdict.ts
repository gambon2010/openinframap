// Fork: a line of sight's answer in words (its card, its split screen, its mark on the
// map).
import { t } from '../../../core/i18n.ts'
import { formatDistance } from '../../../core/earth.ts'
import type { ProfilePoint, SightResult, SightSettings } from './sight.ts'

/** "Seen (12 m clear)", "Hidden by trees 6.38 km away (taken as 15 m; 18 m above the
 * line)": the margin is how far the eye's line to the target passes over the highest
 * thing between, or how far that rises above it; a height the map doesn't give is
 * said as taken. */
export function sightVerdict(result: SightResult, settings: SightSettings): string {
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
  const aboveLine = margin ? t('userlayers.sight-above-line', '{{margin}} m above the line', { margin }) : ''
  const said = [assumedHeight(result, settings), aboveLine].filter(Boolean).join('; ')
  return said ? `${by} (${said})` : by
}

/** The map's mark where the target is first hidden: "Trees 15 m", "Building 12 m",
 * "Ground". */
export function sightBlockLabel(result: SightResult): string {
  const height = Math.round(blockingPoint(result)?.[3] ?? 0)
  if (result.blocked_by === 'trees') return t('userlayers.sight-mark-trees', 'Trees {{height}} m', { height })
  if (result.blocked_by === 'building')
    return t('userlayers.sight-mark-building', 'Building {{height}} m', { height })
  return t('userlayers.sight-mark-ground', 'Ground')
}

/** The height taken for what hides the target, when the map gives none: trees always
 * (the map has no tree heights), a building standing at the height asked for buildings
 * without one. */
function assumedHeight(result: SightResult, settings: SightSettings): string {
  if (result.blocked_by === 'trees')
    return t('userlayers.sight-trees-taken', 'trees taken as {{height}} m', { height: settings.trees })
  const point = blockingPoint(result)
  if (result.blocked_by === 'building' && point && point[3] === settings.buildings)
    return t('userlayers.sight-building-taken', 'its height taken as {{height}} m', {
      height: settings.buildings
    })
  return ''
}

/** The sample where the target is first hidden. */
function blockingPoint(result: SightResult): ProfilePoint | undefined {
  const at = result.blocked_at
  if (at === null || !result.profile.length) return undefined
  return result.profile.reduce((best, p) => (Math.abs(p[0] - at) < Math.abs(best[0] - at) ? p : best))
}
