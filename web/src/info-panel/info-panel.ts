/*
 * Fork: feature details in a panel on the left (instead of a popup over the
 * map), stacked above the Grid connection panel.
 *
 * Minimise keeps the panel's highlight on the map and shrinks it to its title;
 * close removes both. Showing another feature replaces the content.
 */
import { IControl } from 'maplibre-gl'
import { t } from 'i18next'
import { el, setChildren } from 'redom'
import './info-panel.css'

export default class InfoPanel implements IControl {
  _container!: HTMLDivElement
  _body!: HTMLDivElement
  _minimise!: HTMLButtonElement
  _onClose?: () => void

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
