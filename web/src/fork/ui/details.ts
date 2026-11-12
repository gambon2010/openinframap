/*
 * Fork: the details panel on the left (instead of a popup over the map): a map
 * feature's details (modules/details), a My layers item's card... One for the
 * whole page, in the left column (left-column.ts). Also the side panels' look
 * and buttons (details.css), which the grid route panel shares.
 *
 * Minimise keeps the panel's highlight on the map and shrinks it to its title;
 * close removes both. Showing something else replaces the content.
 */
import { IControl, MapGeoJSONFeature } from 'maplibre-gl'
import { t } from '../core/i18n.ts'
import { el, setChildren } from 'redom'
import './details.css'

/**
 * What a module adds to a map feature's details (buttons, more information),
 * given the feature and the details' content once shown. May finish later.
 */
export type DetailsExtra = (feature: MapGeoJSONFeature, content: HTMLElement) => void

const extras: DetailsExtra[] = []

export function addDetailsExtra(extra: DetailsExtra) {
  extras.push(extra)
}

export function detailsExtras(): readonly DetailsExtra[] {
  return extras
}

/** A details row: its label and its value (nothing: the row is left out). */
export type DetailsRow = [label: string, value: string | Node | null | undefined | false]

/**
 * A map feature's details as the panel shows them: a title, a table of the rows
 * that have a value, and what goes under it (a source notice...). For modules
 * that write their own (popup.html in types.ts).
 */
export function detailsCard(
  title: string,
  rows: DetailsRow[],
  ...under: (Node | null | undefined)[]
): HTMLElement {
  return el(
    'div.oim-popup-content',
    el('div.oim-popup-header', el('h3', title)),
    el(
      'table.item_info',
      rows
        .filter(([, value]) => value)
        .map(([label, value]) => el('tr', el('th', label), el('td', value as string | Node)))
    ),
    under.filter((node) => node)
  )
}

export class DetailsPanel implements IControl {
  _container!: HTMLDivElement
  _body!: HTMLDivElement
  _minimise!: HTMLButtonElement
  _onClose?: () => void
  private shownListeners: (() => void)[] = []

  /** Called each time something is shown (e.g. the grid route folds to make room). */
  onShow(listener: () => void) {
    this.shownListeners.push(listener)
  }

  onAdd() {
    this._body = el('div', { class: 'oim-side-panel-body' })
    this._minimise = minimiseButton(() => this.toggleMinimised())
    const close = closeButton(() => this.close())
    this._container = el(
      'div',
      { class: 'maplibregl-ctrl oim-popup oim-popup-info oim-side-panel oim-info-panel' },
      el('div', { class: 'oim-side-panel-buttons' }, this._minimise, close),
      this._body
    ) as HTMLDivElement
    return this._container
  }

  onRemove() {
    this._container.remove()
  }

  /** Show content; onClose runs when it's closed or replaced (e.g. to clear a highlight). */
  show(content: HTMLElement, onClose?: () => void) {
    const previous = this._onClose
    this._onClose = undefined
    previous?.()
    this._onClose = onClose
    setChildren(this._body, [content])
    this._container.classList.add('visible')
    this.setMinimised(false)
    for (const listener of this.shownListeners) listener()
  }

  isOpen(): boolean {
    return this._container.classList.contains('visible')
  }

  /** Where extra content can be added after show() (e.g. async details). */
  get body(): HTMLDivElement {
    return this._body
  }

  close() {
    this._container.classList.remove('visible')
    setChildren(this._body, [])
    const onClose = this._onClose
    this._onClose = undefined
    onClose?.()
  }

  toggleMinimised() {
    this.setMinimised(!this._container.classList.contains('minimised'))
  }

  setMinimised(minimised: boolean) {
    this._container.classList.toggle('minimised', minimised)
    updateMinimiseButton(this._minimise, minimised)
  }
}

export function minimiseButton(onclick: () => void): HTMLButtonElement {
  const button = el('button', { class: 'oim-side-panel-button', type: 'button' }) as HTMLButtonElement
  button.onclick = onclick
  updateMinimiseButton(button, false)
  return button
}

export function updateMinimiseButton(button: HTMLButtonElement, minimised: boolean) {
  button.textContent = minimised ? '+' : '–'
  const label = minimised ? t('panel.restore', 'Restore') : t('panel.minimise', 'Minimise')
  button.title = label
  button.setAttribute('aria-label', label)
}

export function closeButton(onclick: () => void): HTMLButtonElement {
  const label = t('panel.close', 'Close')
  const button = el('button', '×', {
    class: 'oim-side-panel-button',
    type: 'button',
    title: label,
    'aria-label': label
  }) as HTMLButtonElement
  button.onclick = onclick
  return button
}
