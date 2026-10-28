// Fork: small changes to upstream's controls.
import { Map } from 'maplibre-gl'
import { ForkModule } from '../types.ts'
import MapSourcesControl from '../map-sources/map-sources.ts'

const ui: ForkModule = {
  init: ({ map }) => {
    // Which background map and geocoder are in use (fork/map-sources).
    map.addControl(new MapSourcesControl(), 'top-right')
    // The layer list opens level with its button and has more groups than fit
    // below it on a laptop screen: cap its height to the map so it scrolls.
    map
      .getContainer()
      .querySelector('.layer-switcher-button')
      ?.addEventListener('mouseover', () => {
        const list = map.getContainer().querySelector<HTMLElement>('.layer-switcher-list')
        if (!list) return
        const top = list.getBoundingClientRect().top - map.getContainer().getBoundingClientRect().top
        list.style.maxHeight = `${map.getContainer().clientHeight - top - 10}px`
        // The wheel scrolls the list, not the map's zoom.
        list.onwheel = (e) => e.stopPropagation()
      })
    // For browser tests (development server only).
    if (import.meta.env.DEV) (window as unknown as { oimMap: Map }).oimMap = map
  }
}

export default ui
