import { describe, expect, it } from 'vitest'
import baseLayers from '../../../style/style_base.ts'
import type { ExpressionSpecification } from 'maplibre-gl'
import { resized, valueFor } from './builder.ts'
import { roadLayers } from './layers.ts'
import { RAILWAYS_LAYER, besideTheOthers, byRank } from './rail-layers.ts'
import { drawingOrder, entryOf, isMapRoadLayer, lookOf } from './index.ts'
import {
  HIGHWAY_COLOUR,
  HIGHWAY_MIN_WIDTH,
  ROAD_WIDTH_SCALE,
  SMALL_ROAD_MIN_WIDTH,
  SMALL_EDGE_HAIRLINE,
  SECONDARY_COLOUR,
  TERTIARY_COLOUR,
  TRAM_COLOUR,
  TRUNK_COLOUR,
  TUNNEL_DASHES,
  TUNNEL_EDGE_DASHES
} from './roads.constants.ts'

const { layers: all, varying } = roadLayers()
type Line = Extract<(typeof all)[number], { type: 'line' }>
const layers = all as Line[]
/** A layer by its id (roads by theirs without the prefix). */
const layer = (id: string) => layers.find((l) => l.id === id || l.id === `roads_${id}`) as Line
const mapWidth = (id: string) => (baseLayers.find((l) => l.id === id) as Line).paint?.['line-width']
/** A paint value in the bold look, over the map or imagery (the layer itself has
 * the light look's, over the map). */
const bold = (id: string, property: string, overImagery = false) => {
  const values = varying.find((v) => v.layerId === layer(id).id && v.property === property)?.values
  return values && valueFor(values, true, overImagery)
}

describe('roads, railways and borders', () => {
  it('are the fork’s own layers, a set to each prefix', () => {
    const prefixes = new Set(layers.map((l) => l.id.split('_')[0]))
    expect(prefixes).toEqual(new Set(['roads', 'railways', 'transit', 'boundaries']))
    expect(new Set(layers.map((l) => l.id)).size).toBe(layers.length)
  })

  it('replace the map’s own roads and railways (its piers stay)', () => {
    for (const id of ['osm_roads_highway', 'osm_roads_tunnels_minor_casing', 'osm_rail_case'])
      expect(isMapRoadLayer(id)).toBe(true)
    for (const id of ['osm_roads_pier', 'osm_runway', 'label_roads_major'])
      expect(isMapRoadLayer(id)).toBe(false)
  })

  it('light over the map until their entry is ticked, bold then; over imagery only ticked', () => {
    const roads = entryOf('roads_ground_highway')
    expect(roads).toBeDefined()
    expect(lookOf(roads, [], false)).toBe('light')
    expect(lookOf(roads, [], true)).toBe('hidden')
    expect(lookOf(roads, [roads ?? ''], true)).toBe('bold')
    expect(lookOf(entryOf('boundaries_countries'), [], true)).toBe('bold') // one look
  })

  it('keep the background map’s widths, a little narrower, never too thin, with an edge around them', () => {
    const highway = resized(mapWidth('osm_roads_highway'), ROAD_WIDTH_SCALE, HIGHWAY_MIN_WIDTH)
    expect(layer('ground_highway').paint?.['line-width']).toEqual(highway)
    expect(layer('ground_highway_edge').paint?.['line-gap-width']).toEqual(highway)
    expect(layer('tunnel_minor').paint?.['line-width']).toEqual(
      resized(mapWidth('osm_roads_minor'), ROAD_WIDTH_SCALE, SMALL_ROAD_MIN_WIDTH)
    )
    expect(layer('railways_main_ground').paint?.['line-width']).toEqual(
      byRank(resized(mapWidth('osm_rail'), 1, 0))
    )
  })

  it('resize only the widths of a width by zoom, not the zooms', () => {
    const width = ['interpolate', ['exponential', 1.6], ['zoom'], 3, 0, 6, 1.1, 18, 36]
    expect(resized(width, 0.5, 3)).toEqual([
      'interpolate',
      ['exponential', 1.6],
      ['zoom'],
      3,
      3,
      6,
      3,
      18,
      18
    ])
    expect(() => resized(4, 1, 3)).toThrow()
  })

  it('differ between the looks in colours and edges only, fading zoomed in over imagery only', () => {
    expect(layer('ground_highway').paint?.['line-color']).toBe(HIGHWAY_COLOUR.light)
    expect(bold('ground_highway', 'line-color')).toBe(HIGHWAY_COLOUR.bold)
    const shapes = varying.filter((v) => !['line-color', 'line-opacity'].includes(v.property))
    expect(shapes.every((v) => v.property === 'line-width' && v.layerId.endsWith('_edge'))).toBe(true)
    expect(layer('ground_highway').paint?.['line-opacity']).toBe(1)
    expect(bold('ground_highway', 'line-opacity')).toBe(1)
    expect(bold('ground_highway', 'line-opacity', true)).toEqual(expect.arrayContaining(['interpolate']))
  })

  it('draw borders over imagery only (the map draws its own)', () => {
    expect(layer('boundaries_countries').paint?.['line-opacity']).toBe(0)
    expect(bold('boundaries_countries', 'line-opacity', true)).toBe(1)
  })

  it('mark tunnels (dashed) instead of hiding them', () => {
    const edge = layer('tunnel_major_edge')
    expect(edge.paint?.['line-dasharray']).toEqual(TUNNEL_EDGE_DASHES)
    expect(JSON.stringify(edge.filter)).toContain('"has","is_tunnel"')
    expect(layer('tunnel_major').paint?.['line-dasharray']).toEqual(TUNNEL_DASHES)
    expect(layer('ground_major').paint?.['line-dasharray']).toBeUndefined()
    expect(layer('railways_main_tunnel').paint?.['line-dasharray']).toEqual(TUNNEL_DASHES)
    expect(layer('railways_main_tunnel_dashes')).toBeUndefined()
    expect(layer('transit_metro_tunnel').paint?.['line-dasharray']).toEqual(TUNNEL_DASHES)
  })

  it('draw tunnels first, then roads from the smallest up, railways, trams, borders on top', () => {
    const at = (id: string) => layers.indexOf(layer(id))
    expect(at('tunnel_paths_edge')).toBe(0)
    expect(at('tunnel_highway')).toBeLessThan(at('ground_paths_edge'))
    expect(at('ground_minor')).toBeLessThan(at('ground_highway_edge'))
    expect(at('ground_highway')).toBeLessThan(at('railways_sidings_ground_edge'))
    expect(at('railways_branch_ground_dashes')).toBeLessThan(at('railways_main_ground_edge'))
    expect(at('railways_main_ground_dashes')).toBeLessThan(at('transit_sidings_ground_edge'))
    expect(layers.slice(-4).map((l) => l.id)).toEqual([
      'transit_tram_ground_edge',
      'transit_tram_ground',
      'boundaries_countries_edge',
      'boundaries_countries'
    ])
  })

  it('draw small roads and paths alike at every zoom, their edge growing from a hairline', () => {
    for (const id of ['ground_paths', 'ground_service', 'ground_minor', 'ground_major'])
      expect(layer(id).minzoom).toBeUndefined()
    const edge = layer('ground_minor_edge').paint?.['line-width']
    expect(edge).toEqual(expect.arrayContaining(['interpolate', SMALL_EDGE_HAIRLINE]))
    expect(typeof layer('ground_major_edge').paint?.['line-width']).toBe('number')
  })

  it('draw ranked railways, a set of layers per rank (a key row each), the more important wider', () => {
    const rail = layer('railways_main_ground')
    expect(rail['source-layer']).toBe(RAILWAYS_LAYER)
    expect(JSON.stringify(rail.filter)).toContain('["==",["get","rank"],"main"]')
    expect(JSON.stringify(rail.paint?.['line-width'])).toContain('"rank"')
    expect(JSON.stringify(layer('railways_main_tunnel').filter)).toContain('"tunnel"')
    expect(JSON.stringify(layer('railways_sidings_ground').filter)).toContain(
      '["==",["get","rank"],"service"]'
    )
  })

  it('draw trams and metro apart from railways, a plain line in each line’s colour, without dashes', () => {
    const transit = '["in",["get","kind"],["literal",["tram","subway","light_rail"]]]'
    expect(JSON.stringify(layer('railways_main_ground').filter)).toContain(`["!",${transit}]`)
    expect(JSON.stringify(layer('transit_tram_ground').filter)).toContain(transit)
    expect(layer('transit_tram_ground').paint?.['line-color']).toBe(TRAM_COLOUR.light)
    expect(bold('transit_tram_ground', 'line-color')).toEqual([
      'to-color',
      ['get', 'colour'],
      TRAM_COLOUR.bold
    ])
    expect(layer('transit_tram_ground_dashes')).toBeUndefined()
  })

  it('draw the lines sharing a track side by side, each a strand’s width from the next', () => {
    const width = ['interpolate', ['linear'], ['zoom'], 12, 2, 18, 8] as ExpressionSpecification
    const offset = besideTheOthers(width) as unknown[]
    expect(offset.slice(0, 4)).toEqual(['interpolate', ['linear'], ['zoom'], 12])
    // Two lines: slot 0 half a strand to the left, slot 1 half to the right.
    const place = (offset[4] as unknown[])[1]
    expect(place).toEqual([
      '-',
      ['coalesce', ['get', 'slot'], 0],
      ['/', ['-', ['coalesce', ['get', 'slots'], 1], 1], 2]
    ])
    expect(layer('transit_tram_ground').paint?.['line-offset']).toBeDefined()
  })

  it('draw trunk roads amber, secondary pale yellow, tertiary white (bold)', () => {
    expect(bold('ground_trunk', 'line-color')).toBe(TRUNK_COLOUR.bold)
    expect(bold('ground_secondary', 'line-color')).toBe(SECONDARY_COLOUR.bold)
    expect(bold('ground_tertiary', 'line-color')).toBe(TERTIARY_COLOUR.bold)
    expect(JSON.stringify(layer('ground_major').filter)).toContain('"trunk","secondary","tertiary"')
  })
})

describe('the drawing order', () => {
  it('the bold layers over the light ones, each in their usual order', () => {
    const looks = new Map([
      ['roads_tunnel_minor', 'light'],
      ['transit_metro_tunnel', 'bold'],
      ['roads_ground_minor', 'light'],
      ['transit_tram_ground', 'bold']
    ])
    expect(drawingOrder(looks)).toEqual([
      'roads_tunnel_minor',
      'roads_ground_minor',
      'transit_metro_tunnel',
      'transit_tram_ground'
    ])
  })
})
