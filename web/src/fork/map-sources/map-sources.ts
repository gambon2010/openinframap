/*
 * "Map sources" panel: shows which servers the map uses (background map,
 * optional Photon geocoder) and lets you switch them for the current tab.
 *
 * Defaults come from web/.env (VITE_BASEMAP_URL, VITE_PHOTON_URL). Overrides are
 * kept in sessionStorage, so they last until the tab is closed.
 */
import { IControl, Map, MapSourceDataEvent, VectorTileSource } from 'maplibre-gl'
import { t } from 'i18next'
import { el, mount } from 'redom'
import {
  BASEMAP_URL,
  BASEMAP_SESSION_KEY,
  CONFIGURED_BASEMAP_URL,
  CONFIGURED_PHOTON_URL,
  DEFAULT_BASEMAP_URL,
  PHOTON_SESSION_KEY,
  getPhotonUrl,
  getSessionUrl,
  setSessionUrl
} from '../config.js'
import './map-sources.css'

const BASEMAP_SOURCE = 'basemap'

type Status = 'ok' | 'error'

/** One configurable source: a URL field with its origin, buttons, status and help. */
abstract class SourceRow {
  input: HTMLInputElement
  origin: HTMLParagraphElement
  status: HTMLParagraphElement
  el: HTMLDivElement
  current: string

  abstract sessionKey: string
  abstract configured: string
  abstract label(): string
  abstract placeholder(): string
  /** An error message, or null if the URL is acceptable. */
  abstract validate(url: string): string | null
  /** Start using the URL (already validated). */
  abstract use(url: string): void
  abstract originText(): string
  abstract helpContent(): (HTMLElement | string)[]

  constructor(current: string) {
    this.current = current
    this.input = el('input', {
      class: 'oim-map-sources-input',
      type: 'text',
      spellcheck: false,
      placeholder: this.placeholder(),
      'aria-label': this.label()
    })
    this.input.onkeydown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') this.apply()
    }
    this.origin = el('p', { class: 'oim-map-sources-origin' })
    this.status = el('p', { class: 'oim-map-sources-status', role: 'status' })

    const help = el('div', { class: 'oim-map-sources-help' }, ...this.helpContent())
    const helpButton = el(
      'button',
      el('span', 'i', { class: 'oim-map-sources-info-icon', 'aria-hidden': 'true' }),
      t('sources.how-default', 'How do I change the default?'),
      { class: 'oim-map-sources-link', type: 'button', 'aria-expanded': 'false' }
    )
    helpButton.onclick = () => {
      const open = help.classList.toggle('visible')
      helpButton.setAttribute('aria-expanded', String(open))
    }

    this.el = el(
      'div',
      { class: 'oim-map-sources-row' },
      el('label', this.label(), { class: 'oim-map-sources-label' }),
      this.input,
      this.origin,
      el(
        'div',
        { class: 'oim-map-sources-buttons' },
        el('button', t('sources.apply', 'Use this URL'), {
          type: 'button',
          class: 'oim-map-sources-primary',
          onclick: () => this.apply()
        }),
        el('button', t('sources.reset', 'Reset to default'), { type: 'button', onclick: () => this.reset() })
      ),
      this.status,
      helpButton,
      help
    ) as HTMLDivElement
    // Not refreshed here: subclass fields (sessionKey, configured) aren't set
    // until after this constructor; the panel calls refresh() once built.
  }

  refresh() {
    this.input.value = this.current
    this.origin.textContent = this.originText()
  }

  apply() {
    const url = this.input.value.trim()
    const error = this.validate(url)
    if (error) {
      this.setStatus(error, 'error')
      return
    }
    // Store only real overrides, so a later change to web/.env takes effect.
    setSessionUrl(this.sessionKey, url === this.configured ? null : url)
    this.current = url
    this.refresh()
    this.use(url)
  }

  reset() {
    setSessionUrl(this.sessionKey, null)
    this.current = this.configured
    this.refresh()
    this.use(this.configured)
  }

  overridden(): boolean {
    return getSessionUrl(this.sessionKey) !== null && this.current !== this.configured
  }

  setStatus(message: string, kind: Status) {
    this.status.textContent = message
    this.status.className = `oim-map-sources-status ${kind}`
  }
}

const code = (text: string) => el('code', text)
const urlStart = (url: string) =>
  /^(https?:\/\/|\/)/.test(url)
    ? null
    : t('sources.invalid-start', 'The URL must start with http://, https:// or /.')

class BasemapRow extends SourceRow {
  sessionKey = BASEMAP_SESSION_KEY
  configured = CONFIGURED_BASEMAP_URL
  map: Map

  constructor(map: Map) {
    super(BASEMAP_URL)
    this.map = map
    // Report tiles that fail to load from the background-map server.
    map.on('error', (event) => {
      if ((event as unknown as MapSourceDataEvent).sourceId === BASEMAP_SOURCE) {
        this.setStatus(
          t(
            'sources.load-error',
            "Couldn't load background tiles from this URL. Check it's right and the server is running."
          ),
          'error'
        )
      }
    })
  }

  label() {
    return t('sources.basemap', 'Background map tiles')
  }

  placeholder() {
    return 'http://localhost:8090/<region>/{z}/{x}/{y}.mvt'
  }

  validate(url: string) {
    return (
      urlStart(url) ||
      (['{z}', '{x}', '{y}'].every((part) => url.includes(part))
        ? null
        : t('sources.invalid-template', 'The URL must contain {z}, {x} and {y}.'))
    )
  }

  use(url: string) {
    ;(this.map.getSource(BASEMAP_SOURCE) as VectorTileSource | undefined)?.setTiles([url])
    this.setStatus(
      url === this.configured
        ? t('sources.reset-done', 'Back to the default background map.')
        : t('sources.applied', 'Background map switched for this tab.'),
      'ok'
    )
  }

  originText() {
    if (this.overridden()) return t('sources.origin-session', 'Changed for this tab only.')
    if (CONFIGURED_BASEMAP_URL !== DEFAULT_BASEMAP_URL)
      return t('sources.origin-env', 'Default, from VITE_BASEMAP_URL in web/.env.')
    return t('sources.origin-builtin', 'Default: the openinframap.org background map.')
  }

  helpContent() {
    return [
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
    ]
  }
}

class PhotonRow extends SourceRow {
  sessionKey = PHOTON_SESSION_KEY
  configured = CONFIGURED_PHOTON_URL

  constructor() {
    super(getPhotonUrl())
  }

  label() {
    return t('sources.photon', 'Address search (Photon, optional)')
  }

  placeholder() {
    return t('sources.photon-placeholder', 'e.g. http://localhost:2322 (empty = not used)')
  }

  validate(url: string) {
    return url === '' ? null : urlStart(url)
  }

  async use(url: string) {
    if (!url) {
      this.setStatus(
        t('sources.photon-off', 'Not using Photon. Places in your region are still found.'),
        'ok'
      )
      return
    }
    this.setStatus(t('sources.photon-checking', 'Checking Photon…'), 'ok')
    try {
      const response = await fetch(`${url.replace(/\/+$/, '')}/api?q=berlin&limit=1`, {
        signal: AbortSignal.timeout(5000)
      })
      if (!response.ok) throw new Error(String(response.status))
      await response.json()
      this.setStatus(t('sources.photon-ok', 'Photon is answering; search uses it in this tab.'), 'ok')
    } catch {
      this.setStatus(
        t(
          'sources.photon-error',
          "Couldn't reach Photon at this URL. Check it's right and the server is running."
        ),
        'error'
      )
    }
  }

  originText() {
    if (getSessionUrl(this.sessionKey) !== null && this.current !== this.configured)
      return t('sources.origin-session', 'Changed for this tab only.')
    if (this.configured) return t('sources.photon-origin-env', 'Default, from VITE_PHOTON_URL in web/.env.')
    return t('sources.photon-origin-none', 'Not used. Places in your region are found without it.')
  }

  helpContent() {
    return [
      el(
        'p',
        t(
          'sources.photon-help-1',
          "Photon is a search server for addresses and places from OpenStreetMap. Cities, towns and villages in the region you built are found without it; Photon adds street addresses and places elsewhere. The setup scripts don't install it: see"
        ),
        ' ',
        el('a', 'github.com/komoot/photon', {
          href: 'https://github.com/komoot/photon',
          target: '_blank',
          rel: 'noopener noreferrer'
        }),
        '.'
      ),
      el(
        'p',
        t('sources.photon-help-2', 'To use one by default, set'),
        ' ',
        code('VITE_PHOTON_URL'),
        ' ',
        t('sources.help-2', 'in'),
        ' ',
        code('web/.env'),
        ':'
      ),
      el('pre', 'VITE_PHOTON_URL=http://localhost:2322'),
      el(
        'p',
        t('sources.help-3', 'Then restart the frontend (Ctrl+C in its window, then'),
        ' ',
        code('bash scripts/start.sh'),
        ').'
      )
    ]
  }
}

class MapSourcesControl implements IControl {
  _container!: HTMLDivElement
  _panel!: HTMLDivElement
  _rows: SourceRow[] = []

  onAdd(map: Map) {
    const button = el('button', {
      class: 'maplibregl-ctrl-icon oim-map-sources-control',
      type: 'button',
      title: t('sources.name', 'Map sources'),
      'aria-label': t('sources.name', 'Map sources')
    })
    button.onclick = () => this.toggle(button)

    this._rows = [new BasemapRow(map), new PhotonRow()]
    this._rows.forEach((row) => row.refresh())
    this._panel = this.buildPanel()
    mount(document.body, this._panel)

    this._container = el('div', button, { class: 'maplibregl-ctrl maplibregl-ctrl-group' })
    return this._container
  }

  onRemove() {
    this._panel.remove()
    this._container.remove()
  }

  buildPanel(): HTMLDivElement {
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
        ...this._rows.map((row) => row.el),
        el(
          'p',
          { class: 'oim-map-sources-note' },
          t('sources.session-note', 'Changes here only last until you close this tab.')
        )
      )
    ) as HTMLDivElement

    panel.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Escape') this.hide()
    })
    return panel
  }

  toggle(button: HTMLButtonElement) {
    if (this._panel.classList.contains('visible')) {
      this.hide()
      return
    }
    const position = button.getBoundingClientRect()
    this._panel.style.top = position.top + 'px'
    this._panel.style.right = document.documentElement.clientWidth - position.left + 8 + 'px'
    this._rows.forEach((row) => row.refresh())
    this._panel.classList.add('visible')
    this._rows[0].input.focus()
  }

  hide() {
    this._panel.classList.remove('visible')
  }
}

export { MapSourcesControl as default }
