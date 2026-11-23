import { describe, expect, test } from 'vitest'
import search, { dropDuplicates, focusSearchOnKey } from './index.ts'
import type { SearchResult } from '../../../search/search.ts'

const result = (name: string, latitude: number, longitude: number, score: number): SearchResult => ({
  name,
  latitude,
  longitude,
  score
})

describe('dropDuplicates', () => {
  test('the same name within ~5 km: the first (best) one is kept', () => {
    const results = [
      result('Strasbourg', 48.58, 7.75, 0.9),
      result('strasbourg', 48.6, 7.76, 0.8),
      result('Strasbourg', 48.7, 7.75, 0.7),
      result('Kehl', 48.58, 7.81, 0.6)
    ]
    expect(dropDuplicates(results).map((r) => r.score)).toEqual([0.9, 0.7, 0.6])
  })
})

describe('result descriptions', () => {
  test('features: their kind and town', () => {
    expect(search.searchDescription!({ type: 'feature', kind: 'power_line', town: 'Duppigheim' })).toBe(
      'Power line, Duppigheim'
    )
    expect(search.searchDescription!({ type: 'feature', kind: 'something_new' })).toBe('something_new')
  })

  test('places: their kind', () => {
    expect(search.searchDescription!({ type: 'place', place_type: 'village' })).toBe('Village')
    expect(search.searchDescription!({ type: 'place', place_type: 'isolated_dwelling' })).toBe(
      'Isolated_dwelling'
    )
  })

  test("others: upstream's", () => {
    expect(search.searchDescription!({ type: 'substation' })).toBeUndefined()
  })
})

describe('the keys to the search box', () => {
  const box = () => document.querySelector<HTMLInputElement>('.oim-search-input')!
  const press = (target: Element, key: string, ctrlKey = false) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true, cancelable: true }))

  test('/ and Ctrl+K put the cursor in it', () => {
    document.body.innerHTML = '<input class="oim-search-input"><div id="map"></div>'
    document.addEventListener('keydown', focusSearchOnKey)
    press(document.getElementById('map')!, '/')
    expect(document.activeElement).toBe(box())
    box().blur()
    press(document.getElementById('map')!, 'k', true)
    expect(document.activeElement).toBe(box())
    document.removeEventListener('keydown', focusSearchOnKey)
  })

  test('/ typed in another field stays there', () => {
    document.body.innerHTML = '<input class="oim-search-input"><input id="name">'
    document.addEventListener('keydown', focusSearchOnKey)
    const name = document.getElementById('name') as HTMLInputElement
    name.focus()
    press(name, '/')
    expect(document.activeElement).toBe(name)
    document.removeEventListener('keydown', focusSearchOnKey)
  })
})
