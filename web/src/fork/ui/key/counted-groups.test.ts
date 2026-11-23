import { describe, expect, test } from 'vitest'
import { Map as MapLibreMap } from 'maplibre-gl'
import { COUNTS, countLabel, kindCount, shownCount, withCount } from './counted-groups.ts'
import { FeatureHider, StyleLayer, specKey } from './feature-hider.ts'

const counts = { fuel: 'site_fuel', storage_tank: 'site_storage_tank' }

describe('groups counting only the kinds shown', () => {
  test('the count of the kinds whose icon is shown', () => {
    const count = JSON.stringify(shownCount(counts, new Set(['site_fuel'])))
    expect(count).toContain(JSON.stringify(kindCount('storage_tank')))
    expect(count).not.toContain(JSON.stringify(kindCount('fuel')))
    // A kind's count is read from between ",fuel:" and the next comma.
    expect(JSON.stringify(kindCount('fuel'))).toContain('",fuel:"')
  })

  test('the style reads the count shown instead of the count given', () => {
    const count = shownCount(counts, new Set(['site_fuel']))
    expect(withCount(['get', 'count_label'], count)).toEqual(countLabel(count))
    expect(withCount(['step', ['get', 'count'], 0.6, 10, 0.75], count)).toEqual([
      'step',
      count,
      0.6,
      10,
      0.75
    ])
    expect(withCount('site_group_fuel', count)).toBe('site_group_fuel')
  })

  test('the hider swaps a group layer’s count and keeps groups with some shown', () => {
    const layout: Record<string, unknown> = {
      'text-field': ['get', 'count_label'],
      'icon-image': 'site_group_fuel'
    }
    const set: Record<string, unknown> = {}
    const map = {
      on: () => undefined,
      getLayoutProperty: (_: string, property: string) => set[property] ?? layout[property],
      setLayoutProperty: (_: string, property: string, value: unknown) => (set[property] = value)
    } as unknown as MapLibreMap
    const hider = new FeatureHider(map)
    const group: StyleLayer = {
      id: 'sites_fuel_group',
      type: 'symbol',
      layout,
      metadata: { [COUNTS]: counts }
    }
    hider.hidden.add(specKey({ icon: 'site_fuel' }))
    const conditions = hider.countGroups([group])
    const count = shownCount(counts, new Set(['site_fuel']))
    expect(conditions.get('sites_fuel_group')).toEqual(['>', count, 0])
    expect(set['text-field']).toEqual(countLabel(count))
    expect(set['icon-image']).toBeUndefined() // reads no count
    // Shown again: as the style gave it.
    hider.hidden.clear()
    expect(hider.countGroups([group]).size).toBe(0)
    expect(set['text-field']).toEqual(['get', 'count_label'])
  })
})
