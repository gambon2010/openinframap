// Fork: hand-overs between layers of the same data at a whole zoom (one layer ends
// where the next starts: upstream's power line labels at zoom 10) moved to where
// that zoom's tiles start showing, half a zoom before: otherwise neither layer draws
// for that half zoom (core/tile-zooms.ts). The fork's own layers are made that way;
// upstream's are moved here, on the map, once its style is loaded.
import type { Map } from 'maplibre-gl'
import { ForkModule } from '../../types.ts'
import { alignedHandOvers, ZoomRangedLayer } from '../../core/tile-zooms.ts'

function align(map: Map) {
  const style = map.getStyle()
  if (!style) return
  const isVector = (source: unknown) => typeof source === 'string' && style.sources[source]?.type === 'vector'
  const moved = alignedHandOvers(style.layers as ZoomRangedLayer[], isVector)
  for (const [id, range] of moved) {
    const layer = map.getLayer(id)
    if (!layer) continue
    map.setLayerZoomRange(id, range.minzoom ?? layer.minzoom ?? 0, range.maxzoom ?? layer.maxzoom ?? 24)
  }
}

const handovers: ForkModule = {
  init: ({ map }) => {
    map.on('style.load', () => align(map))
    if (map.isStyleLoaded()) align(map)
    else map.once('load', () => align(map))
  }
}

export default handovers
