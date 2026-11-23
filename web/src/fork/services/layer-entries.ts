// Fork: following the Data layers' entries (upstream's layer switcher) from code: the
// roads' looks, the 3D view's relief.
import type { LayerSwitcher } from '@russss/maplibregl-layer-switcher'

/** Calls `changed` after each change of the switcher's entries (a tick, the map's
 * address, the start): when the layers' visibility doesn't change (light already
 * shown), the map doesn't say so. */
export function onEntriesChange(switcher: LayerSwitcher, changed: () => void) {
  const update = switcher._updateVisibility.bind(switcher)
  switcher._updateVisibility = () => {
    update()
    changed()
  }
}
