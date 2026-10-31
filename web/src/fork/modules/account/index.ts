// Fork: the logged-in account (docs/plans/sync.md, "Login for the whole app"; the
// backend's web-backend/src/fork/auth/). The header says who is logged in, with
// "log out"; admins manage the accounts in Settings (accounts.ts). When the session
// has ended (an answer 401 from this site), back to the login page.
import { el } from 'redom'
import { t } from '../../core/i18n.ts'
import { ForkModule } from '../../types.ts'
import { addSettingsSection } from '../../ui/settings.ts'
import { AccountsSection } from './accounts.ts'
import './account.css'

export interface Me {
  name: string
  is_admin: boolean
  can_set_statuses: boolean
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
  init: () => {
    watchForLogout()
    void fetch('/auth/me').then(async (response) => {
      if (!response.ok) return
      const me = (await response.json()) as Me
      const link = el('a', t('account.logout', 'log out ({{name}})', { name: me.name }), {
        href: '#logout',
        onclick: (e: Event) => {
          e.preventDefault()
          void logout()
        }
      })
      // A space first, as between the header's own items (index.html).
      document.querySelector('header nav ul')?.append(' ', el('li', link))
      if (me.is_admin) {
        const section = new AccountsSection(me)
        addSettingsSection({ el: section.el, refresh: () => void section.load(), order: 90 })
      }
    })
  }
}

export default account
