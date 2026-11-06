// Fork: the Settings window, opened with the gear among the map's buttons (top
// right). It holds the app's settings, the sections modules add with
// addSettingsSection (e.g. the background: map or satellite, modules/satellite; the
// map sources, modules/map-sources; accounts). A module's own settings (My layers')
// are in its own window, opened from it.
import { t } from '../core/i18n.ts'
import type { Map } from 'maplibre-gl'
import { addMapButton } from './map-button.ts'
import { gearIcon } from './icons.ts'
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

export function addSettings(map: Map) {
  const made = makeModal(t('settings.title', 'Settings'), ...sections.map((s) => s.el))
  body = made.body

  const openWindow = () => {
    for (const section of sections) section.refresh?.()
    made.open()
    ;[...sections]
      .reverse()
      .find((s) => s.focus)
      ?.focus?.()
  }
  addMapButton(map, {
    content: gearIcon(),
    title: t('settings.title', 'Settings'),
    className: 'oim-settings-button',
    onclick: openWindow
  })
}
