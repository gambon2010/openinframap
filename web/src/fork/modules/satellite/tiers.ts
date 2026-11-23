// Fork: the satellite imagery's tiers (one map source each, coarsest first) from the
// list the scripts write (scripts/offline_maps/inventory.py imagery_list, served by the
// backend's /imagery), and whether the imagery covers a view.
import type { Bounds } from '../../services/background.ts'

export interface Tier {
  url: string
  minzoom: number
  maxzoom: number
  /** Its credit line. */
  attribution: string
  /** What its file covers (from its header): the map asks it for nothing outside. */
  bounds?: Bounds
}

/** One entry of the list, as the scripts write it. */
interface Listed {
  file: string
  format: string
  minzoom: number
  maxzoom: number
  bounds: number[] | null
  credit: string
}

function isListed(entry: unknown): entry is Listed {
  const e = entry as Partial<Listed> | null
  return (
    !!e &&
    typeof e.file === 'string' &&
    typeof e.format === 'string' &&
    Number.isInteger(e.minzoom) &&
    Number.isInteger(e.maxzoom) &&
    e.minzoom! <= e.maxzoom!
  )
}

/** The list's entries as tiers, their tiles at `server`, coarsest first; entries that
 * aren't one are left out. */
export function tiersOf(listed: unknown, server: string): Tier[] {
  if (!Array.isArray(listed)) return []
  return listed
    .filter(isListed)
    .map((entry) => ({
      url: `${server}/${entry.file}/{z}/{x}/{y}.${entry.format}`,
      minzoom: entry.minzoom,
      maxzoom: entry.maxzoom,
      attribution: typeof entry.credit === 'string' ? entry.credit : '',
      ...(entry.bounds?.length === 4 && entry.bounds.every(Number.isFinite)
        ? { bounds: entry.bounds as Bounds }
        : {})
    }))
    .sort((a, b) => a.minzoom - b.minzoom)
}

/** Whether any of the imagery's bounds overlap the view. */
export function covers(imagery: Bounds[], view: Bounds): boolean {
  return imagery.some(([w, s, e, n]) => w < view[2] && e > view[0] && s < view[3] && n > view[1])
}
