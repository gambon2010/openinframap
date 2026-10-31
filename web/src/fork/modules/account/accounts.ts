// Fork: the accounts, for admins (Settings → Accounts): add one, give or take the
// rights (admin, can set statuses), set a new password, disable one. Backend:
// /auth/users (web-backend/src/fork/auth/routes.py).
import { el, setChildren } from 'redom'
import { t } from '../../core/i18n.ts'
import type { Me } from './index.ts'

interface Account {
  id: number
  name: string
  is_admin: boolean
  can_set_statuses: boolean
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
    const tick = (account: Account, key: 'is_admin' | 'can_set_statuses' | 'disabled', label: string) => {
      const box = el('input', { type: 'checkbox', checked: account[key], title: label }) as HTMLInputElement
      box.onchange = () => void this.change(account.id, { [key]: box.checked })
      return el('td', box)
    }
    setChildren(this.list, [
      el(
        'tr',
        el('th', t('account.name', 'Name')),
        el('th', t('account.admin', 'Admin')),
        el('th', t('account.statuses', 'Can set statuses')),
        el('th', t('account.disabled', 'Disabled')),
        el('th', '')
      ),
      ...users.map((u) =>
        el(
          'tr',
          el('td', u.name === this.me.name ? `${u.name} (${t('account.you', 'you')})` : u.name),
          tick(u, 'is_admin', t('account.admin', 'Admin')),
          tick(u, 'can_set_statuses', t('account.statuses', 'Can set statuses')),
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
    const statuses = el('input', { type: 'checkbox' }) as HTMLInputElement
    const form = el(
      'form.oim-accounts-add',
      el('h4', t('account.add', 'Add an account')),
      name,
      password,
      el('label', admin, t('account.admin', 'Admin')),
      el('label', statuses, t('account.statuses', 'Can set statuses')),
      el('button.oim-button', t('account.create', 'Create'), { type: 'submit' })
    ) as HTMLFormElement
    form.onsubmit = async (e) => {
      e.preventDefault()
      this.error.textContent = ''
      try {
        await call('/auth/users', 'POST', {
          name: name.value,
          password: password.value,
          is_admin: admin.checked,
          can_set_statuses: statuses.checked
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
