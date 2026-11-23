// Fork: a building copied from the map (the copy tool, map/tools/copy.ts): its exact
// outline, drawn as an area in its colour, its name written in it. Its shape is the
// building's: it can't be dragged or reshaped (no handles), only named, coloured,
// noted, moved to another layer or deleted.
import { toolIcon } from '../ui/tool-icons.ts'
import { t } from '../../../core/i18n.ts'
import { ItemKind } from './types.ts'

export const building: ItemKind = {
  id: 'building',
  noun: () => t('userlayers.kind.building', 'building'),
  what: () => t('userlayers.what.building', 'Building'),
  drawn: 'standard',
  thumbnail: () => toolIcon('building', 16),
  coloured: () => true,
  movable: false,
  filters: () => ['graphics']
}
