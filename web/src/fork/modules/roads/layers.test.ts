import { describe, expect, it } from 'vitest'
import baseLayers from '../../../style/style_base.ts'
import { RAILWAYS_LAYER, byRank, isRoadLayer, resized, roadLayers } from './layers.ts'
import { isUpstreamRoadLayer } from './index.ts'
import {
  HIGHWAY_COLOUR,
  HIGHWAY_MIN_WIDTH,
  MAJOR_COLOUR,
  MINOR_COLOUR,
  ROAD_WIDTH_SCALE,
  SMALL_ROAD_MIN_WIDTH,
  SMALL_EDGE_HAIRLINE,
  TUNNEL_DASHES,
  TUNNEL_EDGE_DASHES
} from './roads.constants.ts'

const { layers: all, following } = roadLayers()
type Line = Extract<(typeof all)[number], { type: 'line' }>
const layers = all as Line[]
const layer = (id: string) => layers.find((l) => l.id === `roads_${id}`) as Line
const mapWidth = (id: string) => (baseLayers.find((l) => l.id === id) as Line).paint?.['line-width']
/** A paint value over imagery (the layer itself has the map's). */
const overImagery = (id: string, property: string) =>
  following.find((f) => f.layerId === `roads_${id}` && f.property === property)?.values.imagery

describe('roads, railways and borders', () => {
  it('are the fork’s own layers, upstream’s hidden (but its piers)', () => {
    expect(layers.every((l) => isRoadLayer(l.id))).toBe(true)
    expect(new Set(layers.map((l) => l.id)).size).toBe(layers.length)
    for (const id of [
      'osm_roads_highway',
      'osm_roads_tunnels_minor_casing',
      'osm_rail',
      'boundaries_country'
    ])
      expect(isUpstreamRoadLayer(id)).toBe(true)
    for (const id of ['osm_roads_pier', 'osm_runway', 'osm_water', 'label_roads_major'])
      expect(isUpstreamRoadLayer(id)).toBe(false)
  })

  it('keep the background map’s widths, a little narrower, never too thin, with an edge around them', () => {
    const highway = resized(mapWidth('osm_roads_highway'), ROAD_WIDTH_SCALE, HIGHWAY_MIN_WIDTH)
    expect(layer('ground_highway').paint?.['line-width']).toEqual(highway)
    expect(layer('ground_highway_edge').paint?.['line-gap-width']).toEqual(highway)
    expect(layer('tunnel_minor').paint?.['line-width']).toEqual(
      resized(mapWidth('osm_roads_minor'), ROAD_WIDTH_SCALE, SMALL_ROAD_MIN_WIDTH)
    )
    expect(layer('rail_ground').paint?.['line-width']).toEqual(byRank(resized(mapWidth('osm_rail'), 1, 0)))
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

  it('differ between the map and imagery in colours and edges only: the same roads, as wide', () => {
    expect(layer('ground_highway').paint?.['line-color']).toBe(HIGHWAY_COLOUR.map)
    expect(overImagery('ground_highway', 'line-color')).toBe(HIGHWAY_COLOUR.imagery)
    expect(overImagery('ground_major', 'line-color')).toBe(MAJOR_COLOUR.imagery)
    expect(overImagery('ground_minor', 'line-color')).toBe(MINOR_COLOUR.imagery)
    expect(overImagery('ground_links', 'line-color')).toBe(MAJOR_COLOUR.imagery)
    const shapes = following.filter((f) => f.property !== 'line-color' && f.property !== 'line-opacity')
    expect(shapes.every((f) => f.property === 'line-width' && f.layerId.endsWith('_edge'))).toBe(true)
  })

  it('fade zoomed in over imagery only', () => {
    expect(layer('ground_highway').paint?.['line-opacity']).toBe(1)
    expect(overImagery('ground_highway', 'line-opacity')).toEqual(expect.arrayContaining(['interpolate']))
  })

  it('mark tunnels (dashed) instead of hiding them', () => {
    const edge = layer('tunnel_major_edge')
    expect(edge.paint?.['line-dasharray']).toEqual(TUNNEL_EDGE_DASHES)
    expect(JSON.stringify(edge.filter)).toContain('"has","is_tunnel"')
    expect(layer('tunnel_major').paint?.['line-dasharray']).toEqual(TUNNEL_DASHES)
    expect(layer('ground_major').paint?.['line-dasharray']).toBeUndefined()
    expect(layer('rail_tunnel').paint?.['line-dasharray']).toEqual(TUNNEL_DASHES)
    expect(layer('rail_tunnel_dashes')).toBeUndefined()
  })

  it('draw tunnels first, then roads from the smallest up, railways, borders on top', () => {
    const at = (id: string) => layers.findIndex((l) => l.id === `roads_${id}`)
    expect(at('tunnel_paths_edge')).toBe(0)
    expect(at('tunnel_highway')).toBeLessThan(at('ground_paths_edge'))
    expect(at('ground_minor')).toBeLessThan(at('ground_highway_edge'))
    expect(at('ground_highway')).toBeLessThan(at('rail_ground_edge'))
    expect(layers.slice(-3).map((l) => l.id)).toEqual([
      'roads_rail_ground_dashes',
      'roads_borders_edge',
      'roads_borders'
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
    const rail = layer('rail_ground')
    expect(rail['source-layer']).toBe(RAILWAYS_LAYER)
    expect(rail.layout?.['line-sort-key']).toBeDefined()
    expect(JSON.stringify(rail.paint?.['line-width'])).toContain('"rank"')
    expect(JSON.stringify(layer('rail_tunnel').filter)).toContain('"tunnel"')
  })
})
