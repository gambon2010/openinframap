// Fork: a button of its own among the map's buttons (top right: Settings, your
// account), in MapLibre's control look.
import type { Map } from 'maplibre-gl'
import { el } from 'redom'

/** The one look of a map button that's pressed (its panel open, its mode on): a soft
 * grey, sunk in (ui/panel.css `.oim-pressed`). `aria-expanded` for a button opening a
 * panel, `aria-pressed` for one switching something on. */
export function showPressed(
  button: HTMLElement,
  pressed: boolean,
  meaning: 'aria-pressed' | 'aria-expanded' = 'aria-pressed'
) {
  button.classList.toggle('oim-pressed', pressed)
  button.setAttribute(meaning, String(pressed))
}

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
