// Fork: infrastructure data from outside OpenStreetMap (the "extra" Tegola map,
// filled by scripts/extra_data.py). Drawn exactly like OSM power lines and
// substations of the same voltage (the tiles carry a nominal voltage) and like
// OSM gas pipes, below the OSM layers; popups say where the data comes from.
import { t } from 'i18next'
import { interpolate, zoom } from './stylehelpers.ts'
import { LayerSpecificationWithZIndex } from './types.ts'
import { ExpressionSpecification } from 'maplibre-gl'
import { voltage_color, voltage_line_thickness, substation_radius, power_opacity } from './style_oim_power.ts'
import { pipeline_colour } from './style_oim_petroleum.ts'
import { text_paint, font } from './common.ts'

// ICPE (classified installations, Géorisques) by category; the key uses these.
export const icpe_colours: { [category: string]: string } = {
  seveso_high: '#C62828',
  seveso_low: '#EF6C00',
  industry: '#7E57C2',
  quarry: '#8D6E63',
  wind: '#00897B',
  livestock: '#7CB342'
}
export function icpe_category_label(category: string): string {
  return (
    {
      seveso_high: t('extra.icpe.seveso-high', 'Seveso site, upper tier'),
      seveso_low: t('extra.icpe.seveso-low', 'Seveso site, lower tier'),
      industry: t('extra.icpe.industry', 'Industrial site'),
      quarry: t('extra.icpe.quarry', 'Quarry'),
      wind: t('extra.icpe.wind', 'Wind farm'),
      livestock: t('extra.icpe.livestock', 'Livestock farm')
    }[category] || category
  )
}
const icpe_colour: ExpressionSpecification = [
  'match',
  ['get', 'category'],
  ...Object.entries(icpe_colours).flat(),
  '#9E9E9E'
] as unknown as ExpressionSpecification
const icpe_seveso: ExpressionSpecification = [
  'in',
  ['get', 'category'],
  ['literal', ['seveso_high', 'seveso_low']]
]

export default function layers(): LayerSpecificationWithZIndex[] {
  return [
    // ICPE sites: Seveso ones larger, outlined dark, and above the others.
    {
      id: 'extra_icpe',
      zorder: 165,
      minzoom: 5,
      source: 'extra',
      'source-layer': 'extra_facility',
      filter: ['==', ['get', 'kind'], 'icpe'],
      type: 'circle',
      layout: { 'circle-sort-key': ['case', icpe_seveso, 1, 0] },
      paint: {
        'circle-color': icpe_colour,
        'circle-radius': interpolate(zoom, [
          [5, ['case', icpe_seveso, 2.5, 1]],
          [10, ['case', icpe_seveso, 5, 2.5]],
          [16, ['case', icpe_seveso, 9, 6]]
        ]),
        'circle-stroke-color': ['case', icpe_seveso, '#3E2723', '#FFFFFF'],
        'circle-stroke-width': interpolate(zoom, [
          [5, 0.5],
          [14, ['case', icpe_seveso, 2, 1]]
        ])
      }
    },
    {
      id: 'extra_icpe_label',
      zorder: 166,
      minzoom: 13,
      source: 'extra',
      'source-layer': 'extra_facility',
      filter: ['==', ['get', 'kind'], 'icpe'],
      type: 'symbol',
      paint: text_paint,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': font,
        'text-size': 11,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-optional': true
      }
    },
    // Gas distribution pipes, like OSM's (style_oim_petroleum.ts), just below them.
    {
      id: 'extra_gas_pipeline_hit',
      zorder: 0.4,
      source: 'extra',
      'source-layer': 'extra_pipeline',
      type: 'line',
      paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 12 }
    },
    {
      id: 'extra_gas_pipeline_case',
      zorder: 0.5,
      source: 'extra',
      'source-layer': 'extra_pipeline',
      type: 'line',
      paint: {
        'line-color': '#666666',
        'line-width': interpolate(zoom, [
          [8, 1.5],
          [16, 1.5]
        ])
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' }
    },
    {
      id: 'extra_gas_pipeline',
      zorder: 0.6,
      source: 'extra',
      'source-layer': 'extra_pipeline',
      type: 'line',
      paint: {
        'line-color': pipeline_colour,
        'line-width': 1
      }
    },
    // Biomethane injection points (where biogas enters the gas network).
    {
      id: 'extra_gas_biomethane',
      zorder: 170,
      minzoom: 5,
      source: 'extra',
      'source-layer': 'extra_facility',
      filter: ['==', ['get', 'kind'], 'biomethane_injection'],
      type: 'symbol',
      paint: { ...text_paint, 'text-opacity': ['step', ['zoom'], 0, 11, 1] },
      layout: {
        'icon-image': 'biomethane_injection',
        'icon-size': interpolate(zoom, [
          [5, 0.3],
          [14, 0.8]
        ]),
        'icon-allow-overlap': true,
        'text-field': ['get', 'name'],
        'text-font': font,
        'text-size': 11,
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-optional': true
      }
    },
    // Invisible and wider than the lines, so thin low-voltage lines are easy to
    // click. Lowest z-order: anything drawn under the pointer is picked first.
    // One per line layer (named after it), so hiding a layer hides its click area.
    ...(['underground', 'overhead'] as const).map((location): LayerSpecificationWithZIndex => ({
      id: location === 'underground' ? 'extra_power_line_underground_hit' : 'extra_power_line_hit',
      zorder: 249,
      source: 'extra',
      'source-layer': 'extra_power_line',
      filter:
        location === 'underground'
          ? ['==', ['get', 'location'], 'underground']
          : ['!=', ['get', 'location'], 'underground'],
      type: 'line',
      paint: {
        'line-color': '#000000',
        'line-opacity': 0,
        'line-width': 12
      }
    })),
    {
      id: 'extra_power_line_underground',
      zorder: 250,
      source: 'extra',
      'source-layer': 'extra_power_line',
      filter: ['==', ['get', 'location'], 'underground'],
      type: 'line',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': voltage_color('voltage'),
        'line-width': voltage_line_thickness,
        'line-dasharray': [3, 2],
        'line-opacity': power_opacity
      }
    },
    {
      id: 'extra_power_line',
      zorder: 251,
      source: 'extra',
      'source-layer': 'extra_power_line',
      filter: ['!=', ['get', 'location'], 'underground'],
      type: 'line',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': voltage_color('voltage'),
        'line-width': voltage_line_thickness,
        'line-opacity': power_opacity
      }
    },
    {
      id: 'extra_power_substation',
      zorder: 252,
      minzoom: 13,
      source: 'extra',
      'source-layer': 'extra_power_substation',
      type: 'circle',
      paint: {
        'circle-radius': substation_radius,
        'circle-color': voltage_color('voltage'),
        'circle-stroke-color': '#333',
        'circle-stroke-width': interpolate(zoom, [
          [13, 0.5],
          [20, 1]
        ]),
        'circle-opacity': power_opacity,
        'circle-stroke-opacity': power_opacity
      }
    }
  ]
}
