import { describe, expect, it } from 'vitest'
import baseLayers from '../../../style/style_base.ts'
import type { ExpressionSpecification } from 'maplibre-gl'
import { RAILWAYS_LAYER, besideTheOthers, byRank, resized, roadLayers } from './layers.ts'
import { isMapRailLayer, isMapRoadLayer, mapRailFilter } from './index.ts'
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

const { layers: all, following } = roadLayers()
type Line = Extract<(typeof all)[number], { type: 'line' }>
const layers = all as Line[]
/** A layer by its id (roads by theirs without the prefix). */
const layer = (id: string) => layers.find((l) => l.id === id || l.id === `roads_${id}`) as Line
const mapWidth = (id: string) => (baseLayers.find((l) => l.id === id) as Line).paint?.['line-width']
/** A paint value over imagery (the layer itself has the map's). */
const overImagery = (id: string, property: string) =>
  following.find((f) => f.layerId === layer(id).id && f.property === property)?.values.imagery

describe('roads, railways and borders', () => {
  it('are the fork’s own layers, a set to each prefix', () => {
    const prefixes = new Set(layers.map((l) => l.id.split('_')[0]))
    expect(prefixes).toEqual(new Set(['roads', 'railways', 'transit', 'boundaries']))
    expect(new Set(layers.map((l) => l.id)).size).toBe(layers.length)
  })

  it('replace the map’s own of their kind when ticked (its piers stay)', () => {
    for (const id of ['osm_roads_highway', 'osm_roads_tunnels_minor_casing'])
      expect(isMapRoadLayer(id)).toBe(true)
    for (const id of ['osm_roads_pier', 'osm_runway', 'label_roads_major'])
      expect(isMapRoadLayer(id)).toBe(false)
    expect(isMapRailLayer('osm_rail_case')).toBe(true)
    const shows = (filter: unknown) => JSON.stringify(filter)
    expect(shows(mapRailFilter(false, false))).not.toContain('subway')
    const transit = '["in",["get","kind_detail"],["literal",["tram","subway","light_rail"]]]'
    expect(shows(mapRailFilter(true, false))).toContain(transit)
    expect(shows(mapRailFilter(false, true))).toContain(`["!",${transit}]`)
  })

  it('keep the background map’s widths, a little narrower, never too thin, with an edge around them', () => {
    const highway = resized(mapWidth('osm_roads_highway'), ROAD_WIDTH_SCALE, HIGHWAY_MIN_WIDTH)
    expect(layer('ground_highway').paint?.['line-width']).toEqual(highway)
    expect(layer('ground_highway_edge').paint?.['line-gap-width']).toEqual(highway)
    expect(layer('tunnel_minor').paint?.['line-width']).toEqual(
      resized(mapWidth('osm_roads_minor'), ROAD_WIDTH_SCALE, SMALL_ROAD_MIN_WIDTH)
    )
    expect(layer('railways_ground').paint?.['line-width']).toEqual(
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

  it('are bold over the map and imagery alike, fading zoomed in over imagery only', () => {
    expect(layer('ground_highway').paint?.['line-color']).toBe(HIGHWAY_COLOUR)
    expect(following.every((f) => f.property === 'line-opacity')).toBe(true)
    expect(layer('ground_highway').paint?.['line-opacity']).toBe(1)
    expect(overImagery('ground_highway', 'line-opacity')).toEqual(expect.arrayContaining(['interpolate']))
  })

  it('draw borders over imagery only (the map draws its own)', () => {
    expect(layer('boundaries_countries').paint?.['line-opacity']).toBe(0)
    expect(overImagery('boundaries_countries', 'line-opacity')).toBe(1)
  })

  it('mark tunnels (dashed) instead of hiding them', () => {
    const edge = layer('tunnel_major_edge')
    expect(edge.paint?.['line-dasharray']).toEqual(TUNNEL_EDGE_DASHES)
    expect(JSON.stringify(edge.filter)).toContain('"has","is_tunnel"')
    expect(layer('tunnel_major').paint?.['line-dasharray']).toEqual(TUNNEL_DASHES)
    expect(layer('ground_major').paint?.['line-dasharray']).toBeUndefined()
    expect(layer('railways_tunnel').paint?.['line-dasharray']).toEqual(TUNNEL_DASHES)
    expect(layer('railways_tunnel_dashes')).toBeUndefined()
    expect(layer('transit_tunnel').paint?.['line-dasharray']).toEqual(TUNNEL_DASHES)
  })

  it('draw tunnels first, then roads from the smallest up, railways, trams, borders on top', () => {
    const at = (id: string) => layers.indexOf(layer(id))
    expect(at('tunnel_paths_edge')).toBe(0)
    expect(at('tunnel_highway')).toBeLessThan(at('ground_paths_edge'))
    expect(at('ground_minor')).toBeLessThan(at('ground_highway_edge'))
    expect(at('ground_highway')).toBeLessThan(at('railways_ground_edge'))
    expect(layers.slice(-5).map((l) => l.id)).toEqual([
      'railways_ground_dashes',
      'transit_ground_edge',
      'transit_ground',
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

  it('draw ranked railways, the more important ones wider and on top', () => {
    const rail = layer('railways_ground')
    expect(rail['source-layer']).toBe(RAILWAYS_LAYER)
    expect(rail.layout?.['line-sort-key']).toBeDefined()
    expect(JSON.stringify(rail.paint?.['line-width'])).toContain('"rank"')
    expect(JSON.stringify(layer('railways_tunnel').filter)).toContain('"tunnel"')
  })

  it('draw trams and metro apart from railways, a plain line in each line’s colour, without dashes', () => {
    const transit = '["in",["get","kind"],["literal",["tram","subway","light_rail"]]]'
    expect(JSON.stringify(layer('railways_ground').filter)).toContain(`["!",${transit}]`)
    expect(JSON.stringify(layer('transit_ground').filter)).toContain(transit)
    expect(layer('transit_ground').paint?.['line-color']).toEqual([
      'to-color',
      ['get', 'colour'],
      TRAM_COLOUR
    ])
    expect(layer('transit_ground_dashes')).toBeUndefined()
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
    expect(layer('transit_ground').paint?.['line-offset']).toBeDefined()
  })

  it('draw trunk roads amber, secondary pale yellow, tertiary white', () => {
    expect(layer('ground_trunk').paint?.['line-color']).toBe(TRUNK_COLOUR)
    expect(layer('ground_secondary').paint?.['line-color']).toBe(SECONDARY_COLOUR)
    expect(layer('ground_tertiary').paint?.['line-color']).toBe(TERTIARY_COLOUR)
    expect(JSON.stringify(layer('ground_major').filter)).toContain('"trunk","secondary","tertiary"')
  })
})
