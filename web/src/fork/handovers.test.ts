// Fork: no data layer leaves half a zoom empty where it hands over to another
// (core/tile-zooms.ts): the whole style, upstream's layers with the fork's.
import { describe, expect, it } from 'vitest'
import { getStyle } from '../style/style.ts'
import { alignedHandOvers, ZoomRangedLayer } from './core/tile-zooms.ts'
import { forkLayers } from './index.ts'

describe('the map’s layers', () => {
  const style = getStyle() as unknown as {
    sources: Record<string, { type: string }>
    layers: ZoomRangedLayer[]
  }
  const isVector = (source: unknown) => typeof source === 'string' && style.sources[source]?.type === 'vector'

  it('of the fork, on vector tiles, end where tiles change (a whole zoom: gone half a zoom early)', () => {
    const ending = (forkLayers() as unknown as ZoomRangedLayer[]).filter(
      (layer) => isVector(layer.source) && layer.maxzoom !== undefined
    )
    expect(ending.length).toBeGreaterThan(0)
    for (const layer of ending) expect(Number.isInteger(layer.maxzoom), layer.id).toBe(false)
  })

  it('of upstream, handing over at a whole zoom, are the ones the handovers module moves', () => {
    const moved = alignedHandOvers(style.layers, isVector)
    // Upstream's power line labels (zoomed out, then the rest from zoom 10).
    expect(moved.get('power_line_label_low_zoom')).toEqual({ maxzoom: 9.5 })
    expect(moved.get('power_line_label')).toEqual({ minzoom: 9.5 })
    // None of the fork's: they're made at tile switches.
    const fork = new Set((forkLayers() as unknown as ZoomRangedLayer[]).map((layer) => layer.id))
    expect([...moved.keys()].filter((id) => fork.has(id))).toEqual([])
  })
})
