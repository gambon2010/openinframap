// Fork: a Settings window, opened from the header next to about / stats / export.
// It holds the map sources (fork/map-sources); more settings can go here.
import { t } from 'i18next'
import { Map } from 'maplibre-gl'
import { el } from 'redom'
import { MapSourcesSection } from '../map-sources/map-sources.ts'
import { makePanel } from './panel.ts'

export function addSettings(map: Map) {
  const sources = new MapSourcesSection(map)
  const { panel } = makePanel('oim-modal', t('settings.title', 'Settings'), sources.el)
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
    panel.classList.add('visible')
    backdrop.classList.add('visible')
    sources.rows[0].input.focus()
  }
  const link = el('a', t('nav.settings', 'settings'), { href: '#settings' })
  link.onclick = open
  document.querySelector('header nav ul')?.append(el('li', link))
}
