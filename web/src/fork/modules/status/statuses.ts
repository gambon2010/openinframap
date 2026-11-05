// Fork: what a map feature's status can be (web-backend/src/fork/userdata/status.py)
// and how each looks: only problems are shown on the map, as a coloured ring or
// casing plus a badge (docs/plans/feature-status.md, look C).
import { t } from '../../core/i18n.ts'
import { SUPPLY_COLOURS } from '../../services/supply.ts'

export type Status =
  | 'operational'
  | 'repaired'
  | 'threatened'
  | 'suspected_damage'
  | 'damaged'
  | 'destroyed'
  | 'under_repair'
  | 'unknown'

export type Evidence = 'seen' | 'reported' | 'imagery'

export interface StatusLook {
  label: string
  color: string
  /** The badge's sign; none for statuses not shown on the map. */
  symbol?: string
}

export const STATUSES: Status[] = [
  'operational',
  'repaired',
  'threatened',
  'suspected_damage',
  'damaged',
  'destroyed',
  'under_repair',
  'unknown'
]

export const PROBLEMS: Status[] = ['threatened', 'suspected_damage', 'damaged', 'destroyed', 'under_repair']

export function statusLook(status: Status): StatusLook {
  switch (status) {
    case 'operational':
      return { label: t('status.operational', 'Operational'), color: '#2b8a3e' }
    case 'repaired':
      return { label: t('status.repaired', 'Repaired'), color: '#2b8a3e' }
    case 'threatened':
      return { label: t('status.threatened', 'Threatened'), color: '#e6b800', symbol: '⚠' }
    case 'suspected_damage':
      // The purple of power supply mode's "at risk" (what it would cut if confirmed),
      // not orange, which there means less power.
      return {
        label: t('status.suspected-damage', 'Suspected damage'),
        color: SUPPLY_COLOURS.risk,
        symbol: '?'
      }
    case 'damaged':
      return { label: t('status.damaged', 'Damaged'), color: '#d62828', symbol: '!' }
    case 'destroyed':
      return { label: t('status.destroyed', 'Destroyed'), color: '#1a1a1a', symbol: '✕' }
    case 'under_repair':
      return { label: t('status.under-repair', 'Under repair'), color: '#1f6fd1', symbol: '🔧' }
    default:
      return { label: t('status.unknown', 'Unknown'), color: '#868e96' }
  }
}

export function evidenceLabel(evidence: Evidence): string {
  switch (evidence) {
    case 'seen':
      return t('status.evidence.seen', 'Seen')
    case 'reported':
      return t('status.evidence.reported', 'Reported')
    default:
      return t('status.evidence.imagery', 'Imagery')
  }
}
