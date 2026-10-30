// Fork: a Settings window, opened from the header next to about / stats / export.
// It holds the map sources (fork/map-sources) and the sections other modules add
// with addSettingsSection (e.g. the background: map or satellite, fork/satellite).
import { t } from 'i18next'
import { Map } from 'maplibre-gl'
import { el } from 'redom'
import { MapSourcesSection } from '../map-sources/map-sources.ts'
import { makePanel } from './panel.ts'

export interface SettingsSection {
  el: HTMLElement
  /** Called each time the window opens. */
  refresh?: () => void
}

const sections: SettingsSection[] = []
let body: HTMLElement | undefined

/** Add a section to the Settings window (above the map sources). */
export function addSettingsSection(section: SettingsSection) {
  sections.push(section)
  body?.prepend(section.el)
}

export function addSettings(map: Map) {
  const sources = new MapSourcesSection(map)
  const made = makePanel(
    'oim-modal',
    t('settings.title', 'Settings'),
    ...sections.map((s) => s.el),
    sources.el
  )
  const panel = made.panel
  body = made.body
  const backdrop = el('.oim-modal-backdrop', panel)
  document.body.append(backdrop)

  const close = () => backdrop.classList.remove('visible')
  // The panel's close button hides the panel: hide the whole window instead.
  new MutationObserver(() => {
    if (!panel.classList.contains('visible')) close()
  }).observe(panel, { attributes: true, attributeFilter: ['class'] })
  backdrop.onclick = (event) => {
    if (event.target === backdrop) close()
  }
  backdrop.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close()
  })

  const open = (event: Event) => {
    event.preventDefault()
    sources.refresh()
    for (const section of sections) section.refresh?.()
    panel.classList.add('visible')
    backdrop.classList.add('visible')
    sources.rows[0].input.focus()
  }
  const link = el('a', t('nav.settings', 'settings'), { href: '#settings' })
  link.onclick = open
  document.querySelector('header nav ul')?.append(el('li', link))
}
