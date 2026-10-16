// Fork: critical sites from OSM (imposm/sites.py, schema/sites.sql, the "sites"
// Tegola map): an icon per kind (web/src/icons/site_*.svg, made by
// scripts/make_site_icons.py) and a light area for sites mapped as areas. One layer
// per category, so the layer switcher and the key can hide each.
import { t } from 'i18next'
import { ExpressionSpecification } from 'maplibre-gl'
import { interpolate, zoom } from './stylehelpers.ts'
import { LayerSpecificationWithZIndex } from './types.ts'
import { text_paint, font } from './common.ts'

// Must match scripts/make_site_icons.py.
export const site_colours: { [category: string]: string } = {
  health: '#D32F2F',
  government: '#1565C0',
  religion: '#6A1B9A',
  fuel: '#E65100',
  transport: '#455A64',
  military: '#2E7D32',
  military_disused: '#8D8D8D',
  food: '#795548',
  water_waste: '#00838F'
}

// category -> kinds (schema/sites.sql), in the order the key lists them.
export const site_kinds: { [category: string]: string[] } = {
  health: ['hospital', 'clinic', 'pharmacy', 'fire_station', 'police', 'ambulance', 'siren'],
  government: [
    'national',
    'prefecture',
    'townhall',
    'tax',
    'social',
    'employment',
    'customs',
    'government',
    'courthouse',
    'prison',
    'embassy',
    'university'
  ],
  religion: ['christian', 'muslim', 'jewish', 'buddhist', 'worship'],
  fuel: ['fuel', 'fuel_depot', 'weapons'],
  transport: ['airport', 'port', 'border', 'rail_yard'],
  military: ['military'],
  military_disused: ['military_disused'],
  food: ['supermarket', 'wholesale', 'distribution', 'silo', 'slaughterhouse'],
  water_waste: ['dam', 'landfill', 'weather']
}

export function site_category_label(category: string): string {
  return (
    {
      health: t('sites.category.health', 'Health and emergency'),
      government: t('sites.category.government', 'Government and public services'),
      religion: t('sites.category.religion', 'Places of worship'),
      fuel: t('sites.category.fuel', 'Fuel and weapons'),
      transport: t('sites.category.transport', 'Transport hubs'),
      military: t('sites.category.military', 'Military'),
      military_disused: t('sites.category.military-disused', 'Disused military (bunkers, trenches...)'),
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
      police: t('sites.kind.police', 'Police, gendarmerie'),
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
      fuel_depot: t('sites.kind.fuel-depot', 'Fuel depot, storage tank'),
      weapons: t('sites.kind.weapons', 'Gun shop, gunsmith'),
      airport: t('sites.kind.airport', 'Airport, airfield'),
      port: t('sites.kind.port', 'Port, harbour'),
      border: t('sites.kind.border', 'Border control'),
      rail_yard: t('sites.kind.rail-yard', 'Rail yard'),
      military: t('sites.kind.military', 'Military site'),
      military_disused: t('sites.kind.military-disused', 'Bunker, trench, fortification'),
      silo: t('sites.kind.silo', 'Silo'),
      slaughterhouse: t('sites.kind.slaughterhouse', 'Slaughterhouse'),
      distribution: t('sites.kind.distribution', 'Distribution centre'),
      supermarket: t('sites.kind.supermarket', 'Supermarket'),
      wholesale: t('sites.kind.wholesale', 'Wholesaler, cash & carry'),
      dam: t('sites.kind.dam', 'Dam'),
      landfill: t('sites.kind.landfill', 'Landfill'),
      weather: t('sites.kind.weather', 'Weather station, radar')
    }[kind] || kind
  )
}

// The icon for each kind, spelled out (not concatenated) so the key's hiding can
// match an icon name in it.
const site_icon: ExpressionSpecification = [
  'match',
  ['get', 'kind'],
  ...Object.values(site_kinds)
    .flat()
    .flatMap((kind) => [kind, `site_${kind}`]),
  // Hindu and Sikh temples (a dozen in France): no Maki icon, the generic one.
  'hindu',
  'site_worship',
  'sikh',
  'site_worship',
  'site_government'
] as unknown as ExpressionSpecification

// Layer ids: sites_<key> and sites_<key>_area, the key being the category except
// for disused military, whose prefix mustn't start with sites_military (the layer
// switcher matches prefixes).
export function site_layer_key(category: string): string {
  return category === 'military_disused' ? 'disused' : category
}

export default function layers(): LayerSpecificationWithZIndex[] {
  return Object.entries(site_colours).flatMap(([category, colour]): LayerSpecificationWithZIndex[] => [
    {
      id: `sites_${site_layer_key(category)}_area`,
      zorder: 4,
      source: 'sites',
      'source-layer': 'sites_area',
      filter: ['==', ['get', 'category'], category],
      type: 'fill',
      paint: {
        'fill-color': colour,
        'fill-opacity': interpolate(zoom, [
          [8, 0.18],
          [16, 0.08]
        ]),
        'fill-outline-color': colour
      }
    },
    // Icons: important sites (always shown, larger, labelled) and the rest, which
    // give way when crowded and are labelled from zoom 15. Two layers, as
    // icon-allow-overlap can't depend on the feature (MapLibre then rejects the
    // whole style). Both start with sites_<key>, for the layer switcher.
    ...([true, false] as const).map((important): LayerSpecificationWithZIndex => ({
      id: `sites_${site_layer_key(category)}${important ? '' : '_minor'}`,
      zorder: important ? 591 : 590,
      source: 'sites',
      'source-layer': 'sites_point',
      filter: [
        'all',
        ['==', ['get', 'category'], category],
        important ? ['==', ['get', 'importance'], 0] : ['>', ['get', 'importance'], 0]
      ],
      type: 'symbol',
      paint: {
        ...text_paint,
        'text-opacity': important ? 1 : ['step', zoom, 0, 15, 1]
      },
      layout: {
        'icon-image': site_icon,
        'icon-size': interpolate(zoom, [
          [8, important ? 0.55 : 0.4],
          [14, important ? 0.85 : 0.65],
          [18, 0.9]
        ]),
        'icon-allow-overlap': important,
        'symbol-sort-key': ['get', 'importance'],
        'text-field': ['get', 'name'],
        'text-font': font,
        'text-size': important ? 12 : 11,
        'text-offset': [0, 1.3],
        'text-anchor': 'top',
        'text-optional': true,
        'text-max-width': 9
      }
    }))
  ])
}
