// Fork: a line of sight's answer checked against itself, for the split screen's debug
// section (sight-panel.ts, with debug on): each sample's lowering for the Earth's
// curvature worked out again from the distance, the margin and where the target is
// first hidden worked out again from the profile. A difference beyond the profile's
// rounding (0.1 m) means the backend and the chart disagree.
import { lineHeightAt, type ProfilePoint, type SightResult } from './sight.ts'

/** The profile's heights are rounded to 0.1 m: two of them in one figure. */
export const ROUNDING = 0.2

export interface SightCheck {
  samples: number
  /** Metres between samples. */
  spacing: number
  /** The lowering at the target: from its sample, and from the formula. */
  dropAtEnd: number | null
  dropAtEndExpected: number
  /** The largest difference between the two over every sample (metres). */
  worstDropError: number
  /** The margin worked out from the profile (null: no sample between the ends). */
  margin: number | null
  /** The first sample between the ends rising above the line (metres along). */
  firstAbove: number | null
}

export function checkSight(result: SightResult): SightCheck {
  const profile = result.profile
  const length = profile[profile.length - 1]?.[0] ?? 0
  const last = profile[profile.length - 1]
  return {
    samples: profile.length,
    spacing: profile.length > 1 ? length / (profile.length - 1) : 0,
    dropAtEnd: last ? dropOf(last) : null,
    dropAtEndExpected: expectedDrop(result, length),
    worstDropError: worstDropError(result),
    margin: marginFromProfile(result),
    firstAbove: firstAboveLine(result)
  }
}

/** How much a sample's top was lowered: its ground and what stands there, less its
 * top as seen from the eye (null: no terrain there). */
export function dropOf([, ground, , standing, , apparent]: ProfilePoint): number | null {
  if (ground === null || apparent === null) return null
  return ground + standing - apparent
}

/** The lowering the formula gives a distance along (as GDAL's viewshed). */
export function expectedDrop(result: SightResult, distance: number): number {
  const { coefficient, earth_radius } = result.curvature
  return (coefficient * distance ** 2) / (2 * earth_radius)
}

function worstDropError(result: SightResult): number {
  let worst = 0
  for (const point of result.profile) {
    const drop = dropOf(point)
    if (drop === null) continue
    worst = Math.max(worst, Math.abs(drop - expectedDrop(result, point[0])))
  }
  return worst
}

/** The samples between the ends with terrain (the ends' own ground can't hide). */
function between(result: SightResult): ProfilePoint[] {
  return result.profile.slice(1, -1).filter((p) => p[5] !== null)
}

/** The least the line passes over a sample by (negative: the most one rises above). */
function marginFromProfile(result: SightResult): number | null {
  let margin: number | null = null
  for (const point of between(result)) {
    const line = lineHeightAt(result, point[0])
    if (line === null || point[5] === null) continue
    const over = line - point[5]
    if (margin === null || over < margin) margin = over
  }
  return margin
}

function firstAboveLine(result: SightResult): number | null {
  for (const point of between(result)) {
    const line = lineHeightAt(result, point[0])
    if (line !== null && point[5] !== null && point[5] > line) return point[0]
  }
  return null
}
