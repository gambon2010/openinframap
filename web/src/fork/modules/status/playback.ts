// Fork: the statuses as they were at a step of their history (GET
// /userdata/status/history), for the Status board's playback.
import type { Feature, FeatureCollection } from 'geojson'
import { Evidence, PROBLEMS, Status } from './statuses.ts'
import { Details } from './fields.ts'

export interface StatusChange {
  id: number
  source: string
  feature_id: number
  status: Status
  previous: Status | null
  evidence: Evidence | null
  note: string | null
  author: string | null
  details: Details
  at: string
}

/** A feature's key in both the statuses and their history. */
export function statusKey(source: string, id: number): string {
  return `${source}:${id}`
}

/** Each feature's last change among the first `step` changes (0: none yet). */
export function statusesAt(changes: StatusChange[], step: number): Map<string, StatusChange> {
  const at = new Map<string, StatusChange>()
  for (const change of changes.slice(0, step)) at.set(statusKey(change.source, change.feature_id), change)
  return at
}

/**
 * The features (from GET /userdata/status?all=1, for their shape and name) with
 * their status at that step: those that had one then; `problemsOnly`, as the map
 * shows them.
 */
export function featuresAt(
  all: FeatureCollection,
  changes: StatusChange[],
  step: number,
  problemsOnly = false
): FeatureCollection {
  const at = statusesAt(changes, step)
  const features: Feature[] = []
  for (const feature of all.features) {
    const p = feature.properties ?? {}
    const change = at.get(statusKey(p.source, p.id))
    if (!change || (problemsOnly && !PROBLEMS.includes(change.status))) continue
    features.push({
      ...feature,
      properties: {
        ...p,
        status: change.status,
        evidence: change.evidence,
        note: change.note,
        author: change.author,
        details: change.details,
        updated_at: change.at
      }
    })
  }
  return { type: 'FeatureCollection', features }
}
