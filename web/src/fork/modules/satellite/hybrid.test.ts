import { describe, expect, it } from 'vitest'
import baseLayers from '../../../style/style_base.ts'
import { atLeast, hybridLayers, isHybridLayer } from './hybrid.ts'
import {
  HIGHWAY_MIN_WIDTH,
  RAIL_MIN_WIDTH,
  SMALL_ROAD_MIN_WIDTH,
  SMALL_ROADS_FROM_ZOOM,
  TUNNEL_DASHES,
  TUNNEL_EDGE_DASHES
} from './hybrid.constants.ts'

type Line = Extract<ReturnType<typeof hybridLayers>[number], { type: 'line' }>
const layers = hybridLayers(true) as Line[]
const layer = (id: string) => layers.find((l) => l.id === `satellite_roads_${id}`) as Line
const mapWidth = (id: string) => (baseLayers.find((l) => l.id === id) as Line).paint?.['line-width']

describe('roads over imagery', () => {
  it('are its own layers, shown only when asked', () => {
    expect(layers.every((l) => isHybridLayer(l.id))).toBe(true)
    expect(new Set(layers.map((l) => l.id)).size).toBe(layers.length)
    expect(layers.every((l) => l.layout?.visibility === 'visible')).toBe(true)
    expect(hybridLayers(false).every((l) => l.layout?.visibility === 'none')).toBe(true)
  })

  it('keep the background map’s widths (their real size), never too thin, with a dark edge around them', () => {
    const highway = atLeast(mapWidth('osm_roads_highway'), HIGHWAY_MIN_WIDTH)
    expect(layer('roads_ground_highway').paint?.['line-width']).toEqual(highway)
    expect(layer('roads_ground_highway_edge').paint?.['line-gap-width']).toEqual(highway)
    expect(layer('roads_tunnel_minor').paint?.['line-width']).toEqual(
      atLeast(mapWidth('osm_roads_minor'), SMALL_ROAD_MIN_WIDTH)
    )
    expect(layer('rail_ground').paint?.['line-width']).toEqual(atLeast(mapWidth('osm_rail'), RAIL_MIN_WIDTH))
  })

  it('raise only the widths of a width by zoom, not the zooms', () => {
    const width = ['interpolate', ['exponential', 1.6], ['zoom'], 3, 0, 6, 1.1, 18, 36]
    expect(atLeast(width, 3)).toEqual(['interpolate', ['exponential', 1.6], ['zoom'], 3, 3, 6, 3, 18, 36])
    expect(() => atLeast(4, 3)).toThrow()
  })

  it('are coloured by importance', () => {
    const colour = (id: string) => layer(id).paint?.['line-color']
    expect(colour('roads_ground_highway')).not.toEqual(colour('roads_ground_major'))
    expect(colour('roads_ground_major')).not.toEqual(colour('roads_ground_minor'))
    expect(colour('roads_ground_links')).toEqual(colour('roads_ground_major'))
  })

  it('mark tunnels (dashed) instead of hiding them', () => {
    const edge = layer('roads_tunnel_major_edge')
    expect(edge.paint?.['line-dasharray']).toEqual(TUNNEL_EDGE_DASHES)
    expect(JSON.stringify(edge.filter)).toContain('"has","is_tunnel"')
    expect(layer('roads_tunnel_highway').paint?.['line-opacity']).toEqual(
      layer('roads_ground_highway').paint?.['line-opacity']
    )
    expect(layer('roads_tunnel_major').paint?.['line-dasharray']).toEqual(TUNNEL_DASHES)
    expect(layer('roads_ground_major').paint?.['line-dasharray']).toBeUndefined()
    expect(layer('rail_tunnel').paint?.['line-dasharray']).toEqual(TUNNEL_DASHES)
    expect(layer('rail_tunnel_dashes')).toBeUndefined()
  })

  it('draw tunnels first (after the small roads zoomed out), then roads from the smallest up, railways, borders on top', () => {
    const at = (id: string) => layers.findIndex((l) => l.id === `satellite_roads_${id}`)
    expect(at('roads_tunnel_highway')).toBeLessThan(at('roads_ground_paths_edge'))
    expect(at('roads_ground_minor')).toBeLessThan(at('roads_ground_highway_edge'))
    expect(at('roads_ground_highway')).toBeLessThan(at('rail_ground_edge'))
    expect(at('rail_ground_dashes')).toBe(layers.length - 3)
    expect(layers.slice(-2).map((l) => l.id)).toEqual([
      'satellite_roads_borders_edge',
      'satellite_roads_borders'
    ])
  })

  it('draw small roads and paths at their size from zoom 14, a thin line before', () => {
    for (const id of ['roads_ground_paths', 'roads_ground_service_edge', 'roads_ground_minor'])
      expect(layer(id).minzoom).toBe(SMALL_ROADS_FROM_ZOOM)
    expect(layer('roads_ground_major').minzoom).toBeUndefined()
    const zoomedOut = layer('roads_small_zoomed_out')
    expect(zoomedOut.maxzoom).toBe(SMALL_ROADS_FROM_ZOOM)
    expect(zoomedOut.minzoom).toBeUndefined()
    expect(layers[0]).toBe(zoomedOut)
  })

  it('draw railways in use, not their remains', () => {
    const filter = JSON.stringify(layer('rail_ground').filter)
    expect(filter).toContain('"light_rail"')
    expect(filter).not.toContain('dismantled')
  })
})
