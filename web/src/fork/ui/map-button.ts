// Fork: a button of its own among the map's buttons (top right: Settings, your
// account), in MapLibre's control look.
import type { Map } from 'maplibre-gl'
import { el } from 'redom'

export function addMapButton(
  map: Map,
  options: {
    content: string | Element
    title: string
    className: string
    onclick: (button: HTMLButtonElement) => void
  }
): HTMLButtonElement {
  const button = el(`button.maplibregl-ctrl-icon.oim-map-button.${options.className}`, options.content, {
    type: 'button',
    title: options.title,
    'aria-label': options.title
  }) as HTMLButtonElement
  button.onclick = () => options.onclick(button)
  map.addControl(
    {
      onAdd: () => el('div.maplibregl-ctrl.maplibregl-ctrl-group', button),
      onRemove: () => button.parentElement?.remove()
    },
    'top-right'
  )
  return button
}
