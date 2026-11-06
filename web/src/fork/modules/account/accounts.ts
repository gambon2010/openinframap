// Fork: the accounts, for admins (Settings → Accounts): add one, give or take the
// admin right, set a new password, disable one. Backend:
// /auth/users (web-backend/src/fork/auth/routes.py).
import { el, setChildren } from 'redom'
import { t } from '../../core/i18n.ts'
import type { Me } from './index.ts'

export interface Account {
  id: number
  name: string
  is_admin: boolean
  disabled: boolean
}

async function call(url: string, method: string, body?: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  })
  if (!response.ok) throw new Error((await response.text()) || response.statusText)
  return response.json()
}

/** Why a right can't be changed here (the box is disabled), or '' if it can. */
export function lockedReason(
  account: Pick<Account, 'name' | 'is_admin'>,
  key: 'is_admin' | 'disabled',
  me: string
): string {
  if (account.name === me) {
    return t('account.locked-self', 'Your own: another admin can change it')
  }
  if (key === 'disabled' && account.is_admin) {
    return t('account.locked-admin', 'An admin: take away the admin right first')
  }
  return ''
}

export class AccountsSection {
  el: HTMLElement
  private list = el('table.oim-accounts')
  private error = el('p.oim-accounts-error')

  constructor(private me: Me) {
    this.el = el(
      'section.oim-settings-section',
      el('h3', t('account.title', 'Accounts')),
      this.list,
      this.error,
      this.addForm()
    )
  }

  async load() {
    try {
      const { users } = (await call('/auth/users', 'GET')) as { users: Account[] }
      this.show(users)
    } catch (err) {
      this.error.textContent = (err as Error).message
    }
  }

  private async change(id: number, changes: Record<string, unknown>) {
    this.error.textContent = ''
    try {
      await call(`/auth/users/${id}`, 'PATCH', changes)
    } catch (err) {
      this.error.textContent = (err as Error).message
    }
    await this.load()
  }

  private show(users: Account[]) {
    const tick = (account: Account, key: 'is_admin' | 'disabled', label: string) => {
      const locked = lockedReason(account, key, this.me.name)
      const box = el('input', {
        type: 'checkbox',
        checked: account[key],
        disabled: Boolean(locked),
        title: locked || label
      }) as HTMLInputElement
      box.onchange = () => void this.change(account.id, { [key]: box.checked })
      return el('td', box)
    }
    setChildren(this.list, [
      el(
        'tr',
        el('th', t('account.name', 'Name')),
        el('th', t('account.admin', 'Admin')),
        el('th', t('account.disabled', 'Disabled')),
        el('th', '')
      ),
      ...users.map((u) =>
        el(
          'tr',
          el('td', u.name === this.me.name ? `${u.name} (${t('account.you', 'you')})` : u.name),
          tick(u, 'is_admin', t('account.admin', 'Admin')),
          tick(u, 'disabled', t('account.disabled', 'Disabled')),
          el(
            'td',
            el('button.oim-button', t('account.new-password', 'New password'), {
              type: 'button',
              onclick: () => {
                const password = prompt(
                  t('account.password-for', 'New password for {{name}}', { name: u.name })
                )
                if (password) void this.change(u.id, { password })
              }
            })
          )
        )
      )
    ])
  }

  private addForm(): HTMLElement {
    const name = el('input', { type: 'text', placeholder: t('account.name', 'Name') }) as HTMLInputElement
    const password = el('input', {
      type: 'password',
      autocomplete: 'new-password',
      placeholder: t('account.password', 'Password (8 characters at least)')
    }) as HTMLInputElement
    const admin = el('input', { type: 'checkbox' }) as HTMLInputElement
    const form = el(
      'form.oim-accounts-add',
      el('h4', t('account.add', 'Add an account')),
      name,
      password,
      el('label', admin, t('account.admin', 'Admin')),
      el('button.oim-button', t('account.create', 'Create'), { type: 'submit' })
    ) as HTMLFormElement
    form.onsubmit = async (e) => {
      e.preventDefault()
      this.error.textContent = ''
      try {
        await call('/auth/users', 'POST', {
          name: name.value,
          password: password.value,
          is_admin: admin.checked
        })
        form.reset()
      } catch (err) {
        this.error.textContent = (err as Error).message
      }
      await this.load()
    }
    return form
  }
}
