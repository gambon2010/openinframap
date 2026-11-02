// Fork: a MIL-STD-2525C symbol (a unit, equipment, an installation...), drawn with
// its labels by @syncpoint/signs.
import { t } from '../../../core/i18n.ts'
import { modifiersToDraw } from '../model/fields.ts'
import { getLabelLevel, ratio, symbolImage, symbolImageName } from '../map/symbols.ts'
import { symbolName } from '../ui/palette.ts'
import { symbolKind } from '../model/sidc.ts'
import { ItemKind } from './types.ts'

export const symbol: ItemKind = {
  id: 'symbol',
  noun: () => t('userlayers.kind.symbol', 'symbol'),
  what: ({ properties: p }) => symbolName(p.sidc ?? '') ?? p.sidc ?? '',
  military: true,
  drawn: 'standard',
  icon: (p) => (p.sidc ? symbolImageName(p.sidc, modifiersToDraw(p.modifiers, getLabelLevel())) : null),
  images: {
    // milsym:<code>[|<modifiers as JSON>]
    prefix: 'milsym',
    make: async (value) => {
      const [sidc, modifiers] = value.split(/\|(.*)/s)
      return { data: await symbolImage(sidc, modifiers ? JSON.parse(modifiers) : {}), pixelRatio: ratio }
    }
  },
  thumbnail: ({ properties: p }, render) => {
    if (!p.sidc) return '⬚'
    if (!render) return null
    try {
      const span = document.createElement('span')
      span.innerHTML = render(p.sidc, 12)
      return span
    } catch {
      return '⬚'
    }
  },
  sized: true,
  filters: (p) => (p.sidc && symbolKind(p.sidc) === 'unit' ? ['units'] : [])
}
