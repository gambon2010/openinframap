// Fork: critical sites from OSM (imposm/sites.py, schema/fork/sites.sql, the "sites"
// Tegola map): an icon per kind (web/src/icons/site_*.svg, made by
// scripts/make_site_icons.py) and a light area for sites mapped as areas. One layer
// per category, so the layer switcher and the key can hide each.
import { t } from '../../core/i18n.ts'
import { ExpressionSpecification } from 'maplibre-gl'
import { interpolate, zoom } from '../../../style/stylehelpers.ts'
import { LayerSpecificationWithZIndex } from '../../../style/types.ts'
import { text_paint, font } from '../../../style/common.ts'
import { COUNTS } from '../../ui/key/counted-groups.ts'

// Must match scripts/make_site_icons.py.
/** A site's area: light, lighter close in (its icon says what it is); over imagery
 * (whose colours would swallow it) a little more (index.ts). */
export const area_opacity = interpolate(zoom, [
  [8, 0.18],
  [16, 0.08]
])
export const AREA_OPACITY_OVER_IMAGERY = 0.2
/** Its outline: what shows where the fill is too light to see. */
const AREA_OUTLINE_WIDTH = 1.5
const AREA_OUTLINE_OPACITY = 0.8

/** A category's area layer (its fill: index.ts follows the background with it). */
export const area_layer_id = (category: string) => `sites_${category}_area`

export const site_colours: { [category: string]: string } = {
  health: '#D32F2F',
  government: '#A67C00',
  police: '#1A237E',
  religion: '#6A1B9A',
  fuel: '#E65100',
  transport: '#455A64',
  military: '#2E7D32',
  food: '#795548',
  water_waste: '#00838F'
}

// category -> kinds (schema/fork/sites.sql), in the order the key lists them.
export const site_kinds: { [category: string]: string[] } = {
  health: ['hospital', 'clinic', 'pharmacy', 'fire_station', 'ambulance', 'siren'],
  police: ['gendarmerie', 'police_national', 'police_municipal', 'police', 'customs', 'border'],
  government: [
    'national',
    'prefecture',
    'townhall',
    'tax',
    'social',
    'employment',
    'government',
    'courthouse',
    'prison',
    'embassy',
    'university'
  ],
  religion: ['christian', 'muslim', 'jewish', 'buddhist', 'worship'],
  fuel: ['fuel', 'storage_tank'],
  transport: ['airport', 'port', 'rail_yard'],
  military: [
    'military_base',
    'military_school',
    'military_office',
    'military_depot',
    'military_range',
    'military_fort',
    'military_radio',
    'military_area',
    'military_disused'
  ],
  food: ['supermarket', 'convenience', 'wholesale', 'distribution', 'silo', 'slaughterhouse'],
  water_waste: ['dam', 'landfill', 'weather']
}

export function site_category_label(category: string): string {
  return (
    {
      health: t('sites.category.health', 'Health and emergency'),
      police: t('sites.category.police', 'Police, gendarmerie, customs'),
      government: t('sites.category.government', 'Government and public services'),
      religion: t('sites.category.religion', 'Places of worship'),
      fuel: t('sites.category.fuel', 'Fuel'),
      transport: t('sites.category.transport', 'Transport hubs'),
      military: t('sites.category.military', 'Military'),
      food: t('sites.category.food', 'Food supply'),
      water_waste: t('sites.category.water-waste', 'Dams, landfills, weather stations')
    }[category] || category
  )
}

export function site_kind_label(kind: string): string {
  return (
    {
      hospital: t('sites.kind.hospital', 'Hospital'),
      clinic: t('sites.kind.clinic', 'Clinic, health centre'),
      pharmacy: t('sites.kind.pharmacy', 'Pharmacy'),
      fire_station: t('sites.kind.fire-station', 'Fire station'),
      gendarmerie: t('sites.kind.gendarmerie', 'Gendarmerie'),
      police_national: t('sites.kind.police-national', 'National police (commissariat)'),
      police_municipal: t('sites.kind.police-municipal', 'Municipal police'),
      police: t('sites.kind.police', 'Police (force not given)'),
      ambulance: t('sites.kind.ambulance', 'Ambulance station'),
      siren: t('sites.kind.siren', 'Warning siren'),
      national: t('sites.kind.national', 'National institution (parliament, ministry)'),
      prefecture: t('sites.kind.prefecture', 'Prefecture'),
      townhall: t('sites.kind.townhall', 'Town hall'),
      tax: t('sites.kind.tax', 'Tax office, public treasury'),
      social: t('sites.kind.social', 'Social security, family allowances (CAF)'),
      employment: t('sites.kind.employment', 'Employment agency'),
      customs: t('sites.kind.customs', 'Customs'),
      government: t('sites.kind.government', 'Other government office'),
      courthouse: t('sites.kind.courthouse', 'Courthouse'),
      prison: t('sites.kind.prison', 'Prison'),
      embassy: t('sites.kind.embassy', 'Embassy, consulate'),
      university: t('sites.kind.university', 'University'),
      christian: t('sites.kind.christian', 'Church (Christian)'),
      muslim: t('sites.kind.muslim', 'Mosque'),
      jewish: t('sites.kind.jewish', 'Synagogue'),
      buddhist: t('sites.kind.buddhist', 'Buddhist temple'),
      worship: t('sites.kind.worship', 'Other place of worship (Hindu, Sikh...)'),
      hindu: t('sites.kind.hindu', 'Hindu temple'),
      sikh: t('sites.kind.sikh', 'Sikh gurdwara'),
      fuel: t('sites.kind.fuel', 'Fuel station'),
      storage_tank: t('sites.kind.storage-tank', 'Storage tank (fuel, gas)'),
      airport: t('sites.kind.airport', 'Airport, airfield'),
      port: t('sites.kind.port', 'Port, harbour'),
      border: t('sites.kind.border', 'Border control'),
      rail_yard: t('sites.kind.rail-yard', 'Rail yard'),
      military_area: t('sites.kind.military-area', 'Other military area'),
      military_base: t('sites.kind.military-base', 'Barracks, base'),
      military_school: t('sites.kind.military-school', 'Military school'),
      military_office: t('sites.kind.military-office', 'Military office, recruitment, checkpoint'),
      military_depot: t('sites.kind.military-depot', 'Ammunition, fuel, supply depot'),
      military_range: t('sites.kind.military-range', 'Range, training ground'),
      military_fort: t('sites.kind.military-fort', 'Fort, fortification in use'),
      military_radio: t('sites.kind.military-radio', 'Radar, radio, signal station'),
      military_disused: t('sites.kind.military-disused', 'Bunker, trench, fortification'),
      silo: t('sites.kind.silo', 'Silo'),
      slaughterhouse: t('sites.kind.slaughterhouse', 'Slaughterhouse'),
      distribution: t('sites.kind.distribution', 'Distribution centre'),
      supermarket: t('sites.kind.supermarket', 'Supermarket'),
      convenience: t('sites.kind.convenience', 'Convenience store'),
      wholesale: t('sites.kind.wholesale', 'Wholesaler, cash & carry'),
      dam: t('sites.kind.dam', 'Dam'),
      landfill: t('sites.kind.landfill', 'Landfill'),
      weather: t('sites.kind.weather', 'Weather station, radar')
    }[kind] || kind
  )
}

// The icon for each kind, spelled out (not concatenated) so the key's hiding can
// match an icon name in it.
// Hindu and Sikh temples (a dozen in France): no Maki icon, the generic one.
const SHARED_ICONS: Record<string, string> = { hindu: 'site_worship', sikh: 'site_worship' }

/** A kind's icon (its key row's too). */
function kind_icon(kind: string): string {
  return SHARED_ICONS[kind] ?? `site_${kind}`
}

const site_icon: ExpressionSpecification = [
  'match',
  ['get', 'kind'],
  ...Object.values(site_kinds)
    .flat()
    .flatMap((kind) => [kind, kind_icon(kind)]),
  'site_government'
] as unknown as ExpressionSpecification

/** Kinds drawn in a colour of their own within their category, grouped apart (in
 * groups of that colour: site_group in schema/fork/sites.sql): disused military grey
 * among the military's green (their icons too: scripts/make_site_icons.py). */
const KIND_COLOURS: { [kind: string]: string } = { military_disused: '#8D8D8D' }

/** Kinds whose key row is unticked at first: disused fortifications (many, and
 * rarely what one looks for). */
export const HIDDEN_AT_FIRST = ['military_disused']

/** A category's areas' colour: its own, but for kinds with their own. */
function area_colour(category: string, colour: string): string | ExpressionSpecification {
  const own = site_kinds[category].filter((kind) => KIND_COLOURS[kind])
  if (!own.length) return colour
  return [
    'match',
    ['get', 'kind'],
    ...own.flatMap((kind) => [kind, KIND_COLOURS[kind]]),
    colour
  ] as unknown as ExpressionSpecification
}

/** A group's disc: its category's, or that of the kind with its own colour it holds
 * (such kinds are grouped apart, so a group holding one holds only it). */
function group_icon(category: string): string | ExpressionSpecification {
  const own = site_kinds[category].filter((kind) => KIND_COLOURS[kind])
  if (!own.length) return `site_group_${category}`
  const holds = (kind: string) => ['<=', 0, ['index-of', `,${kind}:`, ['coalesce', ['get', 'kinds'], '']]]
  return [
    'case',
    ...own.flatMap((kind) => [holds(kind), `site_group_${kind}`]),
    `site_group_${category}`
  ] as unknown as ExpressionSpecification
}

// Groups are drawn larger the more sites they stand for: their icon and text size
// for counts from 2, 10, 100 and 1000.
const group_steps: [number, number, number][] = [
  [2, 0.6, 10],
  [10, 0.75, 11],
  [100, 0.9, 12],
  [1000, 1.05, 13]
]

// By count: ['step', count, a(2), 10, a(10), 100, a(100)...]
function by_group_size(value: (icon_size: number, text_size: number) => unknown): ExpressionSpecification {
  return [
    'step',
    ['get', 'count'],
    value(group_steps[0][1], group_steps[0][2]),
    ...group_steps.slice(1).flatMap(([count, icon_size, text_size]) => [count, value(icon_size, text_size)])
  ] as unknown as ExpressionSpecification
}

export default function layers(): LayerSpecificationWithZIndex[] {
  return Object.entries(site_colours).flatMap(([category, colour]): LayerSpecificationWithZIndex[] => [
    {
      id: area_layer_id(category),
      zorder: 4,
      source: 'sites',
      'source-layer': 'sites_area',
      filter: ['==', ['get', 'category'], category],
      type: 'fill',
      paint: {
        'fill-color': area_colour(category, colour),
        'fill-opacity': area_opacity
      }
    },
    {
      id: `${area_layer_id(category)}_outline`,
      zorder: 4,
      source: 'sites',
      'source-layer': 'sites_area',
      filter: ['==', ['get', 'category'], category],
      type: 'line',
      paint: {
        'line-color': area_colour(category, colour),
        'line-width': AREA_OUTLINE_WIDTH,
        'line-opacity': AREA_OUTLINE_OPACITY
      }
    },
    // Icons, all shown (overlapping if need be): below zoom 14, nearby sites of the
    // same category come as one group (site_points in schema/fork/sites.sql), drawn by
    // the _group layer. Important sites are larger and labelled; the rest are
    // labelled from zoom 15.
    {
      id: `sites_${category}`,
      zorder: 590,
      source: 'sites',
      'source-layer': 'sites_point',
      filter: ['all', ['==', ['get', 'category'], category], ['!', ['has', 'count_label']]],
      type: 'symbol',
      paint: text_paint,
      layout: {
        'icon-image': site_icon,
        'icon-size': [
          'interpolate',
          ['linear'],
          zoom,
          4,
          ['case', ['==', ['get', 'importance'], 0], 0.45, 0.35],
          14,
          ['case', ['==', ['get', 'importance'], 0], 0.85, 0.65],
          18,
          0.9
        ],
        'icon-allow-overlap': true,
        'symbol-sort-key': ['-', 2, ['get', 'importance']],
        'text-field': [
          'step',
          zoom,
          ['case', ['==', ['get', 'importance'], 0], ['get', 'name'], ''],
          15,
          ['get', 'name']
        ],
        'text-font': font,
        'text-size': 11,
        'text-offset': [0, 1.3],
        'text-anchor': 'top',
        'text-optional': true,
        'text-max-width': 9
      }
    },
    // A group: a disc in the category's colour with how many sites it stands for,
    // larger for more (groups of different categories in one place are spread out
    // by site_points). Clicking one zooms in (openinframap.ts). Its kinds' icons: the
    // key hiding a kind counts only the others (ui/key/counted-groups.ts).
    {
      id: `sites_${category}_group`,
      zorder: 591,
      metadata: { [COUNTS]: Object.fromEntries(site_kinds[category].map((kind) => [kind, kind_icon(kind)])) },
      source: 'sites',
      'source-layer': 'sites_point',
      filter: ['all', ['==', ['get', 'category'], category], ['has', 'count_label']],
      type: 'symbol',
      paint: {
        'text-color': '#fff'
      },
      layout: {
        'icon-image': group_icon(category),
        'icon-size': by_group_size((icon_size) => icon_size),
        'icon-allow-overlap': true,
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        'text-field': ['get', 'count_label'],
        'text-font': font,
        'text-size': by_group_size((_, text_size) => text_size)
      }
    }
  ])
}
