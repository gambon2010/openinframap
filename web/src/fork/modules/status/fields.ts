// Fork: extra fields of a status by kind of feature (web-backend/src/fork/userdata/
// status.py FIELDS): stock and what's short for stores and depots, capacity for
// hospitals and clinics, fuel for fuel stations and depots.
import { MapGeoJSONFeature } from 'maplibre-gl'
import { t } from '../../core/i18n.ts'

export type FieldKey = 'stock' | 'short' | 'capacity' | 'fuel'
export type Details = Partial<Record<FieldKey, string>>

export interface Field {
  key: FieldKey
  label: string
  /** Choices (value, label); none: free text. */
  choices?: [string, string][]
}

/** The fields, labelled in the language in use (so made when needed, not on load). */
export function fields(): Record<FieldKey, Field> {
  return {
    stock: {
      key: 'stock',
      label: t('status.field.stock', 'Stock'),
      choices: [
        ['full', t('status.stock.full', 'Full')],
        ['half', t('status.stock.half', 'Half')],
        ['low', t('status.stock.low', 'Low')],
        ['empty', t('status.stock.empty', 'Empty')],
        ['unknown', t('status.stock.unknown', 'Unknown')]
      ]
    },
    short: { key: 'short', label: t('status.field.short', 'What is short') },
    capacity: {
      key: 'capacity',
      label: t('status.field.capacity', 'Capacity'),
      choices: [
        ['normal', t('status.capacity.normal', 'Normal')],
        ['saturated', t('status.capacity.saturated', 'Saturated')],
        ['closed', t('status.capacity.closed', 'Closed')]
      ]
    },
    fuel: {
      key: 'fuel',
      label: t('status.field.fuel', 'Fuel available'),
      choices: [
        ['yes', t('status.fuel.yes', 'Yes')],
        ['no', t('status.fuel.no', 'No')],
        ['rationed', t('status.fuel.rationed', 'Rationed')]
      ]
    }
  }
}

// Critical sites (modules/sites) by kind.
const STOCK_KINDS = ['supermarket', 'convenience', 'wholesale', 'distribution', 'silo', 'fuel_depot']
const CAPACITY_KINDS = ['hospital', 'clinic']
const FUEL_KINDS = ['fuel', 'fuel_depot']

/** The extra fields a feature's status has (its tile layer and kind). */
export function fieldsFor(layer: string, kind: unknown): Field[] {
  if (!layer.startsWith('sites_') || typeof kind !== 'string') return []
  const all = fields()
  const found: Field[] = []
  if (STOCK_KINDS.includes(kind)) found.push(all.stock, all.short)
  if (CAPACITY_KINDS.includes(kind)) found.push(all.capacity)
  if (FUEL_KINDS.includes(kind)) found.push(all.fuel)
  return found
}

export function fieldsOf(feature: MapGeoJSONFeature): Field[] {
  return fieldsFor(feature.sourceLayer ?? '', feature.properties['kind'])
}

/** "Stock: Low · What is short: water" */
export function detailsText(details: Details | undefined): string {
  const all = fields()
  return Object.entries(details ?? {})
    .filter(([key, value]) => value && key in all)
    .map(([key, value]) => {
      const field = all[key as FieldKey]
      const label = field.choices?.find(([v]) => v === value)?.[1] ?? value
      return `${field.label}: ${label}`
    })
    .join(' · ')
}

// Small parts a status would say nothing useful about: switches, compensators,
// cabinets, gantries, poles, and busbars and bays (lines inside substations). As
// web-backend/src/fork/userdata/status.py (NO_STATUS, can_have_status).
const NO_STATUS = [
  'power_switch',
  'power_compensator',
  'power_portal_way',
  'telecoms_cabinet',
  'water_cabinet'
]

export function canHaveStatus(layer: string | undefined, properties: Record<string, unknown>): boolean {
  if (!layer || NO_STATUS.includes(layer)) return false
  if (layer === 'power_tower' && properties['type'] === 'pole') return false
  if (layer === 'power_line' && ['busbar', 'bay'].includes(String(properties['line']))) return false
  return true
}
