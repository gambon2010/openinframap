/*
 * "Map sources" panel: shows which background-map tile server is in use and
 * lets you switch to another one for the current browser tab.
 *
 * The default comes from VITE_BASEMAP_URL in web/.env (or openinframap.org).
 * Overrides are kept in sessionStorage, so they last until the tab is closed.
 */
import { IControl, Map, MapSourceDataEvent, VectorTileSource } from 'maplibre-gl'
import { t } from 'i18next'
import { el, mount } from 'redom'
import {
  BASEMAP_URL,
  CONFIGURED_BASEMAP_URL,
  DEFAULT_BASEMAP_URL,
  getSessionBasemapUrl,
  setSessionBasemapUrl
} from '../config.js'
import './map-sources.css'

const BASEMAP_SOURCE = 'basemap'

class MapSourcesControl implements IControl {
  _map?: Map
  _container!: HTMLDivElement
  _panel!: HTMLDivElement
  _input!: HTMLInputElement
  _origin!: HTMLParagraphElement
  _status!: HTMLParagraphElement
  _help!: HTMLDivElement
  _currentUrl: string = BASEMAP_URL

  onAdd(map: Map) {
    this._map = map

    const button = el('button', {
      class: 'maplibregl-ctrl-icon oim-map-sources-control',
      type: 'button',
      title: t('sources.name', 'Map sources'),
      'aria-label': t('sources.name', 'Map sources')
    })
    button.onclick = () => this.toggle(button)

    this._panel = this.buildPanel()
    mount(document.body, this._panel)

    // Report tiles that fail to load from the background-map server.
    map.on('error', (event) => {
      const sourceEvent = event as unknown as MapSourceDataEvent
      if (sourceEvent.sourceId === BASEMAP_SOURCE) {
        this.setStatus(
          t(
            'sources.load-error',
            "Couldn't load background tiles from this URL. Check it's right and the server is running."
          ),
          'error'
        )
      }
    })

    this._container = el('div', button, { class: 'maplibregl-ctrl maplibregl-ctrl-group' })
    return this._container
  }

  onRemove() {
    this._panel.remove()
    this._container.remove()
    this._map = undefined
  }

  buildPanel(): HTMLDivElement {
    this._input = el('input', {
      class: 'oim-map-sources-input',
      type: 'text',
      spellcheck: false,
      value: this._currentUrl,
      'aria-label': t('sources.basemap', 'Background map tiles')
    })
    this._input.onkeydown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') this.apply()
    }

    this._origin = el('p', { class: 'oim-map-sources-origin' })
    this._status = el('p', { class: 'oim-map-sources-status', role: 'status' })

    const helpButton = el(
      'button',
      el('span', 'i', { class: 'oim-map-sources-info-icon', 'aria-hidden': 'true' }),
      t('sources.how-default', 'How do I change the default?'),
      { class: 'oim-map-sources-link', type: 'button', 'aria-expanded': 'false' }
    )
    this._help = this.buildHelp()
    helpButton.onclick = () => {
      const open = this._help.classList.toggle('visible')
      helpButton.setAttribute('aria-expanded', String(open))
    }

    const closeButton = el('button', '×', {
      class: 'oim-map-sources-close',
      type: 'button',
      title: t('sources.close', 'Close'),
      'aria-label': t('sources.close', 'Close')
    })
    closeButton.onclick = () => this.hide()

    const panel = el(
      'div',
      { class: 'oim-map-sources-panel', role: 'dialog', 'aria-label': t('sources.name', 'Map sources') },
      el('div', { class: 'oim-map-sources-header' }, el('h2', t('sources.name', 'Map sources')), closeButton),
      el(
        'div',
        { class: 'oim-map-sources-body' },
        el('label', t('sources.basemap', 'Background map tiles'), { class: 'oim-map-sources-label' }),
        this._input,
        this._origin,
        el(
          'div',
          { class: 'oim-map-sources-buttons' },
          el('button', t('sources.apply', 'Use this URL'), {
            type: 'button',
            class: 'oim-map-sources-primary',
            onclick: () => this.apply()
          }),
          el('button', t('sources.reset', 'Reset to default'), {
            type: 'button',
            onclick: () => this.reset()
          })
        ),
        this._status,
        el(
          'p',
          { class: 'oim-map-sources-note' },
          t('sources.session-note', 'Changes here only last until you close this tab.')
        ),
        helpButton,
        this._help
      )
    ) as HTMLDivElement

    panel.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape') this.hide()
    })
    this.updateOrigin()
    return panel
  }

  buildHelp(): HTMLDivElement {
    const code = (text: string) => el('code', text)
    return el(
      'div',
      { class: 'oim-map-sources-help' },
      el(
        'p',
        t('sources.help-1', 'To change the default for this copy of the project, set'),
        ' ',
        code('VITE_BASEMAP_URL'),
        ' ',
        t('sources.help-2', 'in'),
        ' ',
        code('web/.env'),
        ':'
      ),
      el('pre', 'VITE_BASEMAP_URL=http://localhost:8090/luxembourg/{z}/{x}/{y}.mvt'),
      el(
        'p',
        t('sources.help-3', 'Then restart the frontend (Ctrl+C in its window, then'),
        ' ',
        code('bash scripts/start.sh'),
        '). ',
        t('sources.help-4', 'Remove the line to go back to the openinframap.org background map.')
      ),
      el(
        'p',
        t(
          'sources.help-5',
          'The URL must contain {z}, {x} and {y}, and the tiles must use the Protomaps basemap layers. To get an offline background map for your region, run "bash scripts/build-region.sh": it downloads one and sets this for you.'
        )
      )
    ) as HTMLDivElement
  }

  toggle(button: HTMLButtonElement) {
    if (this._panel.classList.contains('visible')) {
      this.hide()
      return
    }
    const position = button.getBoundingClientRect()
    this._panel.style.top = position.top + 'px'
    this._panel.style.right = document.documentElement.clientWidth - position.left + 8 + 'px'
    this._input.value = this._currentUrl
    this._panel.classList.add('visible')
    this._input.focus()
  }

  hide() {
    this._panel.classList.remove('visible')
  }

  apply() {
    const url = this._input.value.trim()
    if (!/^(https?:\/\/|\/)/.test(url)) {
      this.setStatus(t('sources.invalid-start', 'The URL must start with http://, https:// or /.'), 'error')
      return
    }
    if (!['{z}', '{x}', '{y}'].every((part) => url.includes(part))) {
      this.setStatus(t('sources.invalid-template', 'The URL must contain {z}, {x} and {y}.'), 'error')
      return
    }
    // Store only real overrides, so a later change to web/.env takes effect.
    setSessionBasemapUrl(url === CONFIGURED_BASEMAP_URL ? null : url)
    this.useUrl(url)
    this.setStatus(t('sources.applied', 'Background map switched for this tab.'), 'ok')
  }

  reset() {
    setSessionBasemapUrl(null)
    this._input.value = CONFIGURED_BASEMAP_URL
    this.useUrl(CONFIGURED_BASEMAP_URL)
    this.setStatus(t('sources.reset-done', 'Back to the default background map.'), 'ok')
  }

  useUrl(url: string) {
    this._currentUrl = url
    const source = this._map?.getSource(BASEMAP_SOURCE) as VectorTileSource | undefined
    source?.setTiles([url])
    this.updateOrigin()
  }

  updateOrigin() {
    let origin: string
    if (getSessionBasemapUrl() && this._currentUrl !== CONFIGURED_BASEMAP_URL) {
      origin = t('sources.origin-session', 'Changed for this tab only.')
    } else if (CONFIGURED_BASEMAP_URL !== DEFAULT_BASEMAP_URL) {
      origin = t('sources.origin-env', 'Default, from VITE_BASEMAP_URL in web/.env.')
    } else {
      origin = t('sources.origin-builtin', 'Default: the openinframap.org background map.')
    }
    this._origin.textContent = origin
  }

  setStatus(message: string, kind: 'ok' | 'error') {
    this._status.textContent = message
    this._status.className = `oim-map-sources-status ${kind}`
  }
}

export { MapSourcesControl as default }
