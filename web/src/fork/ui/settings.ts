// Fork: a Settings window, opened from the header next to about / stats / export.
// It holds the sections modules add with addSettingsSection (e.g. the background:
// map or satellite, modules/satellite; the map sources, modules/map-sources).
import { t } from '../core/i18n.ts'
import { el } from 'redom'
import { makeModal } from './panel.ts'

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
  const made = makeModal(t('settings.title', 'Settings'), ...sections.map((s) => s.el))
  body = made.body

  const open = (event: Event) => {
    event.preventDefault()
    for (const section of sections) section.refresh?.()
    made.open()
    ;[...sections]
      .reverse()
      .find((s) => s.focus)
      ?.focus?.()
  }
  const link = el('a', t('nav.settings', 'settings'), { href: '#settings' })
  link.onclick = open
  document.querySelector('header nav ul')?.append(el('li', link))
}
