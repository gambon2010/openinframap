// Fork: a tactical graphic (a boundary, an axis of advance...): control points,
// drawn by the C5ISR renderer (map/graphics.ts).
import { t } from '../../../core/i18n.ts'
import { GEOMETRY_ICONS } from '../ui/palette.constants.ts'
import { toolIcon } from '../ui/tool-icons.ts'
import { entryOf, symbolName } from '../ui/palette.ts'
import { ItemKind } from './types.ts'

export const graphic: ItemKind = {
  id: 'graphic',
  noun: () => t('userlayers.kind.graphic', 'graphic'),
  what: ({ properties: p }) => symbolName(p.sidc ?? '') ?? p.sidc ?? '',
  military: true,
  drawn: 'graphic',
  thumbnail: ({ properties: p }) =>
    toolIcon(GEOMETRY_ICONS[entryOf(p.sidc ?? '')?.[3] ?? 'M'] ?? 'graphic', 16),
  filters: () => ['graphics']
}
