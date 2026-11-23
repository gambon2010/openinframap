// Fork: a picture uploaded to the backend, placed on the map.
import { toolIcon } from '../ui/tool-icons.ts'
import { el } from 'redom'
import { t } from '../../../core/i18n.ts'
import { imageUrl } from '../state/api.ts'
import { pictureImage } from '../map/symbols.ts'
import { ItemKind } from './types.ts'

export const image: ItemKind = {
  id: 'image',
  noun: () => t('userlayers.kind.image', 'picture'),
  what: () => t('userlayers.what.image', 'Picture'),
  drawn: 'standard',
  icon: (p) => (p.image ? `userimg:${p.image}` : null),
  images: {
    prefix: 'userimg',
    make: async (id) => {
      const { image, pixelRatio } = await pictureImage(id)
      return { data: image, pixelRatio }
    }
  },
  thumbnail: ({ properties: p }) =>
    p.image ? el('img', { src: imageUrl(p.image), alt: '' }) : toolIcon('image', 16),
  sized: true,
  filters: () => ['pictures']
}
