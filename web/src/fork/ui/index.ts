// Fork: changes to upstream's controls. The layer list and the key open on click
// in the right-hand dock (fork/ui/dock.ts), with one look for all panels
// (panel.css); the map sources are in a Settings window opened from the header.
import { t } from 'i18next'
import { Map } from 'maplibre-gl'
import { mount } from 'redom'
import { ForkModule } from '../types.ts'
import { dock } from './dock.ts'
import { makePanel } from './panel.ts'
import { addSettings } from './settings.ts'

const ui: ForkModule = {
  init: ({ map, layerSwitcher }) => {
    dock.attach(map)

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

    addSettings(map)

    // For browser tests (development server only).
    if (import.meta.env.DEV) (window as unknown as { oimMap: Map }).oimMap = map
  }
}

export default ui
