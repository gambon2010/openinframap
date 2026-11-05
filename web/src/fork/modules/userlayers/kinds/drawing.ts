// Fork: a drawing: a free line or area, in its colour and width.
import { t } from '../../../core/i18n.ts'
import { ItemKind, Item } from './types.ts'

const area = (item: Item) => item.geometry?.type === 'Polygon' || item.geometry?.type === 'MultiPolygon'

export const drawing: ItemKind = {
  id: 'drawing',
  noun: (item) => (area(item) ? t('userlayers.kind.area', 'area') : t('userlayers.kind.line', 'line')),
  what: (item) => (area(item) ? t('userlayers.what.area', 'Area') : t('userlayers.what.line', 'Line')),
  drawn: 'standard',
  thumbnail: (item) => (area(item) ? '▱' : '╱'),
  coloured: true,
  lineWidth: true,
  filters: () => ['graphics']
}
