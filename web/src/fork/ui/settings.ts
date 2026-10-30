// Fork: a Settings window, opened from the header next to about / stats / export.
// It holds the sections modules add with addSettingsSection (e.g. the background:
// map or satellite, modules/satellite; the map sources, modules/map-sources).
import { t } from '../core/i18n.ts'
import { el } from 'redom'
import { makePanel } from './panel.ts'

export interface SettingsSection {
  el: HTMLElement
  /** Called each time the window opens. */
  refresh?: () => void
  /** Where it goes: lower first (default 0). */
  order?: number
  /** Put the cursor in it when the window opens (the last section that has one). */
  focus?: () => void
}

const sections: SettingsSection[] = []
let body: HTMLElement | undefined

/** Add a section to the Settings window. */
export function addSettingsSection(section: SettingsSection) {
  sections.push(section)
  sections.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  body?.replaceChildren(...sections.map((s) => s.el))
}

export function addSettings() {
  const made = makePanel('oim-modal', t('settings.title', 'Settings'), ...sections.map((s) => s.el))
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
    for (const section of sections) section.refresh?.()
    panel.classList.add('visible')
    backdrop.classList.add('visible')
    ;[...sections]
      .reverse()
      .find((s) => s.focus)
      ?.focus?.()
  }
  const link = el('a', t('nav.settings', 'settings'), { href: '#settings' })
  link.onclick = open
  document.querySelector('header nav ul')?.append(el('li', link))
}
