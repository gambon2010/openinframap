// Fork: the logged-in account (docs/plans/sync.md, "Login for the whole app"; the
// backend's web-backend/src/fork/auth/). A button among the map's (top right) says
// who is logged in, with "Log out"; admins manage the accounts in Settings
// (accounts.ts). When the session
// has ended (an answer 401 from this site), back to the login page.
import { addMapButton } from '../../ui/map-button.ts'
import { personIcon } from '../../ui/icons.ts'
import { openContextMenuFor } from '../../ui/context-menu.ts'
import { t } from '../../core/i18n.ts'
import { ForkModule } from '../../types.ts'
import { addSettingsSection } from '../../ui/settings.ts'
import { AccountsSection } from './accounts.ts'
import './account.css'

export interface Me {
  name: string
  is_admin: boolean
}

export function loginUrl(): string {
  return `/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`
}

/** An answer from this site saying the session has ended (not from logging in itself). */
export function sessionEnded(url: string, status: number, origin = location.origin): boolean {
  if (status !== 401) return false
  const target = new URL(url, origin)
  return target.origin === origin && !target.pathname.startsWith('/auth/')
}

function watchForLogout() {
  const fetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const response = await fetch(input, init)
    const url = input instanceof Request ? input.url : String(input)
    if (sessionEnded(url, response.status)) location.assign(loginUrl())
    return response
  }
}

async function logout() {
  await fetch('/auth/logout', { method: 'POST' }).catch(() => undefined)
  location.assign('/login')
}

const account: ForkModule = {
  init: ({ map }) => {
    watchForLogout()
    void fetch('/auth/me').then(async (response) => {
      if (!response.ok) return
      const me = (await response.json()) as Me
      addMapButton(map, {
        content: personIcon(),
        title: t('account.button', 'Logged in as {{name}}', { name: me.name }),
        className: 'oim-account-button',
        onclick: (button) =>
          openContextMenuFor(button, [
            { heading: t('account.button', 'Logged in as {{name}}', { name: me.name }) },
            { label: t('account.logout', 'Log out'), run: () => void logout() }
          ])
      })
      if (me.is_admin) {
        const section = new AccountsSection(me)
        addSettingsSection({ el: section.el, refresh: () => void section.load(), order: 90 })
      }
    })
  }
}

export default account
