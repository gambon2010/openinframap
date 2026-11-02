// Fork: a measurement: a distance (each leg's length and bearing, marks along the
// way), an area (and its perimeter) or range rings round a point. Drawn by
// map/render.ts from measure/features.ts; its points are moved like a drawing's.
import { el } from 'redom'
import { t } from '../../../core/i18n.ts'
import { formatDistance, parseDistances } from '../measure/geo.ts'
import { measurementOf, summary } from '../measure/features.ts'
import { measurePrefs } from '../measure/prefs.ts'
import { ItemKind, Item } from './types.ts'

const ICONS = { distance: '📏', area: '⬠', rings: '◎' }

const NAMES = () => ({
  distance: t('userlayers.kind.measure-distance', 'distance'),
  area: t('userlayers.kind.measure-area', 'measured area'),
  rings: t('userlayers.kind.measure-rings', 'range rings')
})

const typeOf = (item: Item) => item.properties.measure ?? 'distance'

export const measure: ItemKind = {
  id: 'measure',
  noun: (item) => NAMES()[typeOf(item)],
  what: (item) => {
    const m = measurementOf(item)
    return m ? `${NAMES()[m.type]}: ${summary(m, measurePrefs.north)}` : NAMES()[typeOf(item)]
  },
  drawn: 'measure',
  thumbnail: (item) => ICONS[typeOf(item)],
  coloured: true,
  filters: () => ['graphics'],
  card: (item, update) => {
    if (typeOf(item) !== 'rings') return []
    // Range rings: their distances, typed ("1, 5, 10 km", "500 m", "3 nm").
    const radii = (item.properties.radii as number[] | undefined) ?? measurePrefs.radii
    const input = el('input', {
      type: 'text',
      value: radii.map(formatDistance).join(', '),
      'data-field': 'radii'
    }) as HTMLInputElement
    input.onchange = () => {
      const value = parseDistances(input.value)
      if (!value.length) return
      update({ radii: value })
      // New rings get these too.
      measurePrefs.set({ radii: value })
    }
    return [
      el(
        '.oim-ul-detail',
        el('span.oim-ul-detail-name', t('userlayers.ring-distances', 'Ring distances')),
        input
      )
    ]
  }
}
