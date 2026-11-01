// Fork: military grid references (MGRS), shown under the cursor and found by the
// search box. The conversion is the `mgrs` package (proj4js); here: how they're
// written and read. Outside 80° S – 84° N there are none (UPS isn't covered).
import { forward, inverse } from 'mgrs'
import type { SearchResult, ISearchProvider } from '../../../search/search.ts'
import { t } from '../../core/i18n.ts'

/** "32T LT 72577 89913" (digits: 5 = 1 m, 4 = 10 m, 3 = 100 m...); null outside MGRS. */
export function toMgrs(lng: number, lat: number, digits = 5): string | null {
  if (lat < -80 || lat > 84) return null
  try {
    const ref = forward([lng, lat], digits)
    const m = /^(\d{1,2}[A-Z])([A-Z]{2})(\d*)$/.exec(ref)
    if (!m) return ref
    const half = m[3].length / 2
    return [m[1], m[2], m[3].slice(0, half), m[3].slice(half)].filter(Boolean).join(' ')
  } catch {
    return null
  }
}

const PATTERN = /^(\d{1,2})([C-HJ-NP-X])([A-HJ-NP-Z]{2})(\d{0,10})$/

/**
 * A grid reference typed in any usual way ("32TLT7257789913", "32T LT 725 899",
 * "32t lt 72577 89913"): the centre of the square it names and its size in metres;
 * null if it isn't one.
 */
export function parseMgrs(text: string): { lng: number; lat: number; size: number } | null {
  const compact = text.replace(/\s+/g, '').toUpperCase()
  const m = PATTERN.exec(compact)
  if (!m || m[4].length % 2 || Number(m[1]) < 1 || Number(m[1]) > 60) return null
  try {
    const [west, south, east, north] = inverse(compact)
    if (![west, south, east, north].every(Number.isFinite)) return null
    return { lng: (west + east) / 2, lat: (south + north) / 2, size: 10 ** (5 - m[4].length / 2) }
  } catch {
    return null
  }
}

export class MgrsSearch implements ISearchProvider {
  async search(query: string): Promise<SearchResult[]> {
    const found = parseMgrs(query)
    if (!found) return []
    return [
      {
        latitude: parseFloat(found.lat.toFixed(6)),
        longitude: parseFloat(found.lng.toFixed(6)),
        name: query.trim().toUpperCase(),
        score: 1,
        description: t('measure.mgrs-result', 'Military grid reference (MGRS)')
      }
    ]
  }
}
