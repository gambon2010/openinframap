// Fork: a copy of a map feature (a power line, a substation...): drawn like the
// original by clones of the map's layers, with all the original's fields.
import { t } from '../../../core/i18n.ts'
import { ItemKind } from './types.ts'

export const copy: ItemKind = {
  id: 'copy',
  noun: ({ properties: p }) => `${t('userlayers.kind.copy', 'copy of')} ${p.copy?.layer ?? ''}`,
  what: ({ properties: p }) =>
    t('userlayers.copy-of-short', 'Copy: {{layer}}', { layer: p.copy?.layer ?? '' }),
  drawn: 'copy',
  thumbnail: () => '⧉',
  movable: false
}
