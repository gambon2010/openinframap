// Fork: the page's layout around upstream's controls. The layer list and the key
// open on click in the right-hand dock (ui/dock.ts), with one look for all panels
// (ui/panel.css); a Settings window opens from the header (ui/settings.ts, where
// modules add sections); the search box is in the top bar, right of the header
// (search-bar.ts).
import { t } from '../../core/i18n.ts'
import { Map } from 'maplibre-gl'
import { mount } from 'redom'
import { ForkModule } from '../../types.ts'
import { dock } from '../../ui/dock.ts'
import { makePanel } from '../../ui/panel.ts'
import { addSettings } from '../../ui/settings.ts'
import { moveSearchToTopBar } from './search-bar.ts'

const ui: ForkModule = {
  init: ({ map, layerSwitcher }) => {
    dock.attach(map)

    // The header: upstream's statistics (OpenStreetMap's completeness by country,
    // for its contributors) and its link to a paid online export don't fit this map
    // (offline, with its own export); "about" is the fork's page (backend fork/about.py).
    for (const link of document.querySelectorAll<HTMLAnchorElement>('header nav a')) {
      const href = link.getAttribute('href') ?? ''
      if (href === '/stats' || href.includes('infrageomatics.com')) link.closest('li')?.remove()
    }

    // Layers: upstream shows its list while the pointer is over the button, level
    // with it and over the other buttons. Put the list in a docked panel instead.
    const container = map.getContainer()
    const switcherButton = container.querySelector<HTMLElement>('.layer-switcher-button')
    // The list element is private to the layer switcher.
    const list = (layerSwitcher as unknown as { _container: HTMLElement })._container
    if (switcherButton && list) {
      switcherButton.onmouseover = null
      list.onmouseleave = null
      const { panel, body } = makePanel('oim-layers-panel', t('layers.title', 'Layers'))
      mount(body, list)
      // The wheel scrolls the list, not the map's zoom.
      panel.onwheel = (e) => e.stopPropagation()
      switcherButton.title = t('layers.title', 'Layers')
      dock.add(switcherButton, panel)
    }

    // Key: upstream puts it over the buttons, level with its button.
    const keyButton = container.querySelector<HTMLElement>('.oim-key-control')
    const keyPanel = document.querySelector<HTMLElement>('.oim-key-panel')
    if (keyButton && keyPanel) {
      keyPanel.onwheel = (e) => e.stopPropagation()
      dock.add(keyButton, keyPanel)
    }

    addSettings()
    moveSearchToTopBar(map)

    // For browser tests (development server only).
    if (import.meta.env.DEV) (window as unknown as { oimMap: Map }).oimMap = map
  }
}

export default ui
