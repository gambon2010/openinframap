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
let openWindow: ((section?: SettingsSection) => void) | undefined

/** Add a section to the Settings window. */
export function addSettingsSection(section: SettingsSection) {
  sections.push(section)
  sections.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  body?.replaceChildren(...sections.map((s) => s.el))
}

export function addSettings() {
  const made = makeModal(t('settings.title', 'Settings'), ...sections.map((s) => s.el))
  body = made.body

  openWindow = (shown) => {
    for (const section of sections) section.refresh?.()
    made.open()
    if (shown) {
      shown.el.scrollIntoView({ block: 'start' })
      return
    }
    ;[...sections]
      .reverse()
      .find((s) => s.focus)
      ?.focus?.()
  }
  const link = el('a', t('nav.settings', 'settings'), { href: '#settings' })
  link.onclick = (event) => {
    event.preventDefault()
    openWindow?.()
  }
  document.querySelector('header nav ul')?.append(el('li', link))
}

/** Open the Settings window (at a section: My layers' ⚙ opens its own). */
export function openSettings(section?: SettingsSection) {
  openWindow?.(section)
}
