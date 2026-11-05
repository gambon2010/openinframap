// Fork: a marker: a plain pin, in its colour.
import { t } from '../../../core/i18n.ts'
import { markerImage, ratio } from '../map/symbols.ts'
import { ItemKind } from './types.ts'

export const marker: ItemKind = {
  id: 'marker',
  noun: () => t('userlayers.kind.marker', 'marker'),
  what: () => t('userlayers.what.marker', 'Marker'),
  drawn: 'standard',
  icon: (p, layerColour) => `user-marker:${p.color ?? layerColour}`,
  images: {
    prefix: 'user-marker',
    make: async (colour) => ({ data: markerImage(colour), pixelRatio: ratio })
  },
  thumbnail: () => '📍',
  sized: true,
  coloured: true,
  filters: () => ['pictures']
}
