// Fork: towers numbered along their lines (web-backend/src/fork/tower_numbers.py):
// the number as the label of a tower without a ref, from zoom 16 (the tower_number
// tile layer), and "Tower 23 of 61 on A - B, counted from A" in a tower's details.
import { MapGeoJSONFeature } from 'maplibre-gl'
import { el } from 'redom'
import { BACKEND_BASE_URL } from '../../config.ts'
import { t } from '../../core/i18n.ts'
import { LayerSpecificationWithZIndex } from '../../../style/types.ts'
import { font, text_paint } from '../../../style/common.ts'

export interface TowerLine {
  number: number
  total: number
  voltage_kv: number
  name: string | null
  start: string | null
  end: string | null
}

export function towerNumberLayers(): LayerSpecificationWithZIndex[] {
  return [
    {
      // Just above upstream's towers (power_tower, 264), which label their ref.
      zorder: 266,
      id: 'power_tower_number',
      type: 'symbol',
      source: 'power',
      'source-layer': 'tower_number',
      minzoom: 16,
      layout: {
        'text-field': ['to-string', ['get', 'number']],
        'text-font': font,
        'text-size': ['interpolate', ['linear'], ['zoom'], 16, 10, 21, 14],
        'text-optional': true,
        'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
        'text-radial-offset': 1
      },
      paint: text_paint
    }
  ]
}

/** "Tower 23 of 61 on A - B (225 kV), counted from A." */
export function describeTower(line: TowerLine): string {
  const name =
    line.name || (line.start && line.end ? `${line.start} – ${line.end}` : t('tower.unnamed-line', 'a line'))
  const text = t('tower.number', 'Tower {{number}} of {{total}} on {{name}} ({{kv}} kV)', {
    number: line.number,
    total: line.total,
    name,
    kv: line.voltage_kv
  })
  return line.start
    ? `${text}, ${t('tower.counted-from', 'counted from {{start}}', { start: line.start })}.`
    : `${text}.`
}

/** A tower's details: its number on each line it carries. */
export async function towerDetails(feature: MapGeoJSONFeature, content: HTMLElement) {
  if (feature.layer.id !== 'power_tower' || feature.properties['osm_id'] === undefined) return
  let lines: TowerLine[]
  try {
    const response = await fetch(`${BACKEND_BASE_URL}/grid/tower/${feature.properties['osm_id']}`)
    if (!response.ok) return
    lines = (await response.json()).lines
  } catch {
    return
  }
  if (!lines.length || !content.isConnected) return
  const info = el(
    'div.oim-tower-numbers',
    lines.map((line) => el('p', describeTower(line)))
  )
  content.insertBefore(info, content.querySelector('.oim-info-footer'))
}
