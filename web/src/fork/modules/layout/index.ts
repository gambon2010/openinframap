// Fork: the page's layout around upstream's controls. No header: upstream's title
// and links (about, stats, a paid export) go; "About this map" is in the map's
// credits (© OpenStreetMap…, bottom right), Settings is a gear among the map's
// buttons (ui/settings.ts, where modules add sections), with print and your
// account. Upstream's layer list and key are one panel, Data layers
// (ui/data-layers.ts), docked on the right (ui/dock.ts), with one look for all
// panels (ui/panel.css); the search box is at the top left (search-bar.ts).
import { t } from '../../core/i18n.ts'
import { Map } from 'maplibre-gl'
import { ForkModule } from '../../types.ts'
import { dock } from '../../ui/dock.ts'
import { buildDataLayers, Switcher } from '../../ui/data-layers.ts'
import { addSettings } from '../../ui/settings.ts'
import { moveSearchToTopBar } from './search-bar.ts'
import { aboutInCredits } from './about.ts'

const ui: ForkModule = {
  init: ({ map, layerSwitcher }) => {
    dock.attach(map)

    // The header: its statistics (OpenStreetMap's completeness by country, for its
    // contributors) and paid online export don't fit this map, and the rest moved.
    document.querySelector('header')?.remove()
    aboutInCredits(map)

    // Data layers: upstream's layer list and key in one docked panel
    // (ui/data-layers.ts), opened with the Layers button; the Key button goes. The
    // key builds its rows after a while (key.ts populate, then forkKey): the panel is
    // made once they're there.
    const container = map.getContainer()
    const switcherButton = container.querySelector<HTMLElement>('.layer-switcher-button')
    const keyButton = container.querySelector<HTMLElement>('.oim-key-control')
    const keyPanel = document.querySelector<HTMLElement>('.oim-key-panel')
    keyButton?.closest('.maplibregl-ctrl')?.remove()
    if (switcherButton) {
      switcherButton.onmouseover = null
      switcherButton.title = t('data-layers.title', 'Data layers')
      switcherButton.setAttribute('aria-label', t('data-layers.title', 'Data layers'))
    }
    const build = () => {
      const pane = keyPanel?.querySelector<HTMLElement>('.oim-key-body')
      if (!switcherButton || !pane || !map.isStyleLoaded()) return false
      const { panel, refresh } = buildDataLayers(map, layerSwitcher as unknown as Switcher, pane)
      // The wheel scrolls the list, not the map's zoom.
      panel.onwheel = (e) => e.stopPropagation()
      dock.add(switcherButton, panel, refresh)
      return true
    }
    let built = false
    const tryBuild = () => {
      if (!built && build()) {
        built = true
        observer.disconnect()
        for (const event of ['load', 'styledata', 'idle'] as const) map.off(event, tryBuild)
      }
    }
    const observer = new MutationObserver(tryBuild)
    if (keyPanel) observer.observe(keyPanel, { childList: true })
    // The map may still be loading its style: again on its next events.
    for (const event of ['load', 'styledata', 'idle'] as const) map.on(event, tryBuild)
    tryBuild()

    addSettings(map)
    moveSearchToTopBar(map)

    // For browser tests (development server only).
    if (import.meta.env.DEV) (window as unknown as { oimMap: Map }).oimMap = map
  }
}

export default ui
