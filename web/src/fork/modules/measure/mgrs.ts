// Fork: grid references (core/mgrs.ts) found by the search box.
import type { SearchResult, ISearchProvider } from '../../../search/search.ts'
import { t } from '../../core/i18n.ts'
import { parseMgrs } from '../../core/mgrs.ts'

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
