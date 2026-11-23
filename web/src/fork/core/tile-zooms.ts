// Fork: zoom ranges and vector tiles. MapLibre picks vector tiles by the map's zoom
// rounded, so a zoom's tiles show from half a zoom before it to half after; and it
// checks a layer's zoom range against the tile's zoom as well as the map's. So a
// layer ending at a whole zoom M is gone from M − 0.5 (M's tiles leave it out), while
// one starting at M starts at M: half a zoom with neither. A hand-over from one layer
// to another goes where the tiles change.

/** How much before its zoom a zoom's tiles show. */
export const TILES_SHOWN_EARLY = 0.5

/** Where the tiles of a zoom start showing: where a hand-over at it belongs. */
export function tilesShownFrom(zoom: number): number {
  return zoom - TILES_SHOWN_EARLY
}

export interface ZoomRangedLayer {
  id: string
  source?: unknown
  'source-layer'?: string
  minzoom?: number
  maxzoom?: number
}

/** A layer's new zoom range (the side that moves). */
export type ZoomRange = { minzoom?: number; maxzoom?: number }

const isWhole = (zoom: number | undefined): zoom is number => zoom !== undefined && Number.isInteger(zoom)

/** Hand-overs at a whole zoom between layers of the same data (the same vector
 * source and source layer): one ending where the other starts. Both moved to where
 * that zoom's tiles start showing. By layer id. */
export function alignedHandOvers(
  layers: ZoomRangedLayer[],
  isVector: (source: unknown) => boolean
): Map<string, ZoomRange> {
  const data = (layer: ZoomRangedLayer) => `${String(layer.source)}/${layer['source-layer'] ?? ''}`
  const vector = layers.filter((layer) => isVector(layer.source))
  const moved = new Map<string, ZoomRange>()
  for (const ending of vector) {
    if (!isWhole(ending.maxzoom)) continue
    const at = ending.maxzoom
    const starting = vector.filter((layer) => layer.minzoom === at && data(layer) === data(ending))
    if (!starting.length) continue
    moved.set(ending.id, { ...moved.get(ending.id), maxzoom: tilesShownFrom(at) })
    for (const layer of starting) moved.set(layer.id, { ...moved.get(layer.id), minzoom: tilesShownFrom(at) })
  }
  return moved
}
