// Fork: infrastructure data from outside OpenStreetMap (the "extra" Tegola map,
// filled by scripts/extra_data.py). Drawn exactly like OSM power lines and
// substations of the same voltage (the tiles carry a nominal voltage) and like
// OSM gas pipes, below the OSM layers; popups say where the data comes from.
import { interpolate, zoom } from './stylehelpers.ts'
import { LayerSpecificationWithZIndex } from './types.ts'
import { voltage_color, voltage_line_thickness, substation_radius, power_opacity } from './style_oim_power.ts'
import { pipeline_colour } from './style_oim_petroleum.ts'
import { text_paint, font } from './common.ts'

export default function layers(): LayerSpecificationWithZIndex[] {
  return [
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
