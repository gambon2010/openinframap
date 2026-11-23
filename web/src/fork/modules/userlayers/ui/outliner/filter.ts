// Fork: My layers' list (outliner/index.ts): what the search box and the chips keep
// (pure).
import { UserFeature } from '../../model/model.ts'
import { kindOf } from '../../kinds/index.ts'
import { featureLabelParts } from '../../model/labels.ts'
import { identity, status } from '../../model/sidc.ts'
import type { Filter } from './types.ts'

export const words = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean)

/** Whether every word of a search is in a text. */
export function textMatches(text: string, query: string): boolean {
  const lower = text.toLowerCase()
  return words(query).every((w) => lower.includes(w))
}

/** Whether an item matches the search text (all words, anywhere in its name, type,
 * details or notes) and every filter chip that's on. */
export function matches(feature: UserFeature, query: string, filters: Set<Filter>): boolean {
  const p = feature.properties
  const sidc = p.sidc ?? ''
  for (const filter of filters) {
    if (filter === 'hostile' && !(sidc && ['H', 'S', 'J', 'K'].includes(identity(sidc)))) return false
    if (filter === 'friend' && !(sidc && ['F', 'A'].includes(identity(sidc)))) return false
    if (filter === 'planned' && !(sidc && status(sidc) === 'A')) return false
    if (
      (filter === 'units' || filter === 'graphics' || filter === 'pictures') &&
      !kindOf(p).filters?.(p).includes(filter)
    )
      return false
  }
  if (!words(query).length) return true
  const { name, what } = featureLabelParts(feature)
  return textMatches([name, what, p.notes, ...Object.values(p.modifiers ?? {})].join(' '), query)
}
