// Fork: a military base's parts (schema/fork/site-parts.sql). Its buildings drawn as
// buildings, those mapped as points as small discs, its zones as thin dashed
// outlines, from zoom 15 and with no icon: the base's icon stands for them, and its
// details count them. A part of another kind is drawn as any site (style.ts). The
// details say what a part is and whose part it is.
import { t } from '../../core/i18n.ts'
import { LayerSpecificationWithZIndex } from '../../../style/types.ts'
import { SAME_FEATURES_AS } from '../../ui/key/feature-hider.ts'
import {
  NOT_A_SITE_OF_ITS_OWN,
  PARTS_MIN_ZOOM,
  PART_OUTLINE_COLOUR,
  PART_POINT_RADIUS,
  PART_ROOF_COLOUR,
  PART_ROOF_OPACITY,
  PART_ZONE_DASHES,
  PART_ZONE_WIDTH
} from './parts.constants.ts'
import { site_colours, site_kind_label } from './style.ts'

/** The building parts' roof layer (index.ts follows the background with it). */
export const PART_ROOF_LAYER = 'sites_military_part_building'

export function partLayers(): LayerSpecificationWithZIndex[] {
  // The same sites as the icons: their key rows hide the parts too.
  const sameAsIcons = { [SAME_FEATURES_AS]: 'sites_point' }
  return [
    {
      id: PART_ROOF_LAYER,
      zorder: 4,
      metadata: sameAsIcons,
      source: 'sites',
      'source-layer': 'sites_area',
      minzoom: PARTS_MIN_ZOOM,
      filter: ['==', ['get', 'part'], 'building'],
      type: 'fill',
      paint: { 'fill-color': PART_ROOF_COLOUR, 'fill-opacity': PART_ROOF_OPACITY.map }
    },
    {
      id: `${PART_ROOF_LAYER}_outline`,
      zorder: 4,
      metadata: sameAsIcons,
      source: 'sites',
      'source-layer': 'sites_area',
      minzoom: PARTS_MIN_ZOOM,
      filter: ['==', ['get', 'part'], 'building'],
      type: 'line',
      paint: { 'line-color': PART_OUTLINE_COLOUR, 'line-width': 1 }
    },
    {
      id: 'sites_military_part_zone',
      zorder: 4,
      metadata: sameAsIcons,
      source: 'sites',
      'source-layer': 'sites_area',
      minzoom: PARTS_MIN_ZOOM,
      filter: ['==', ['get', 'part'], 'zone'],
      type: 'line',
      paint: {
        'line-color': site_colours.military,
        'line-width': PART_ZONE_WIDTH,
        'line-dasharray': PART_ZONE_DASHES
      }
    },
    {
      id: 'sites_military_part_point',
      zorder: 589,
      source: 'sites',
      'source-layer': 'sites_point',
      minzoom: PARTS_MIN_ZOOM,
      filter: NOT_A_SITE_OF_ITS_OWN,
      type: 'circle',
      paint: {
        'circle-radius': PART_POINT_RADIUS,
        'circle-color': PART_ROOF_COLOUR,
        'circle-stroke-color': site_colours.military,
        'circle-stroke-width': 1.5
      }
    }
  ]
}

/** What a part is, as a person would say it: its military value (a bunker), else a
 * kind's label; a value not listed here, as a building or a part of the site. */
export function partLabel(what: string, part: string): string {
  const listed: Record<string, string> = {
    bunker: t('sites.part.bunker', 'Bunker'),
    casemate: t('sites.part.casemate', 'Casemate'),
    cupola: t('sites.part.cupola', 'Armoured cupola'),
    embrasure: t('sites.part.embrasure', 'Embrasure (firing post)'),
    barracks: t('sites.part.barracks', 'Barracks building'),
    office: t('sites.part.office', 'Office'),
    checkpoint: t('sites.part.checkpoint', 'Checkpoint, guard post'),
    hangar: t('sites.part.hangar', 'Hangar'),
    range: t('sites.part.range', 'Range'),
    danger_area: t('sites.part.danger-area', 'Danger area'),
    training_area: t('sites.part.training-area', 'Training area')
  }
  if (listed[what]) return listed[what]
  const kind = site_kind_label(what)
  if (kind !== what) return kind
  return part === 'building' ? t('sites.part.building', 'Building') : t('sites.part.zone', 'Part of the site')
}

/** A base's parts as its details list them: "118 × Bunker, 3 × Barracks building". */
export function partsSummary(parts: string): string {
  return parts
    .split(',')
    .map((entry) => entry.split(':'))
    .filter(([what, count]) => what && count)
    .map(([what, count]) => `${count} × ${partLabel(what, '')}`)
    .join(', ')
}
