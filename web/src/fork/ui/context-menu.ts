// Fork: one right-click menu for the whole app's lists (My layers' layers and
// folders): it opens where it's asked, inside the window, and closes on a click
// elsewhere, Escape, scrolling or choosing an entry. Entries are buttons; an entry
// with a submenu is a <details> (opens in place). Keyboard: the arrows move between
// entries, and openContextMenuFor(row) opens it under a row (the Menu key, Shift+F10).
import { el } from 'redom'
import './context-menu.css'

export interface MenuEntry {
  label: string
  run?: () => void
  /** Shown greyed out. */
  disabled?: boolean
  /** A submenu instead of an action. */
  entries?: MenuEntry[]
  /** Drawn in red: deleting. */
  danger?: boolean
}

/** A heading, a line between groups, or an entry. */
export type MenuItem = MenuEntry | 'separator' | { heading: string }

let menu: HTMLElement | null = null

export function closeContextMenu() {
  menu?.remove()
  menu = null
  document.removeEventListener('pointerdown', outside, true)
  document.removeEventListener('keydown', keys, true)
  window.removeEventListener('blur', closeContextMenu)
  document.removeEventListener('scroll', closeContextMenu, true)
}

function outside(e: Event) {
  if (menu && !menu.contains(e.target as Node)) closeContextMenu()
}

function keys(e: KeyboardEvent) {
  if (!menu) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    closeContextMenu()
    return
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  const buttons = [...menu.querySelectorAll<HTMLElement>('button:not([disabled]), summary')].filter(
    (b) => b.offsetParent !== null
  )
  const at = buttons.indexOf(document.activeElement as HTMLElement)
  const next = e.key === 'ArrowDown' ? at + 1 : at - 1
  buttons[(next + buttons.length) % buttons.length]?.focus()
}

function entryElement(entry: MenuEntry): HTMLElement {
  if (entry.entries) {
    return el(
      'details.oim-menu-sub',
      el('summary', entry.label),
      entry.entries.map((e) => entryElement(e))
    )
  }
  const button = el(`button${entry.danger ? '.oim-menu-danger' : ''}`, entry.label, {
    type: 'button',
    disabled: Boolean(entry.disabled)
  }) as HTMLButtonElement
  button.onclick = () => {
    closeContextMenu()
    entry.run?.()
  }
  return button
}

/** Open the menu at x, y (the window's pixels). */
export function openContextMenu(x: number, y: number, items: MenuItem[]) {
  closeContextMenu()
  menu = el(
    '.oim-context-menu',
    { role: 'menu' },
    items.map((item) =>
      item === 'separator' ? el('hr') : 'heading' in item ? el('h4', item.heading) : entryElement(item)
    )
  )
  document.body.append(menu)
  // Inside the window: moved left or up when it would run off.
  const box = menu.getBoundingClientRect()
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - box.width - 4))}px`
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - box.height - 4))}px`
  menu.querySelector<HTMLElement>('button:not([disabled]), summary')?.focus()
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('keydown', keys, true)
  window.addEventListener('blur', closeContextMenu)
  // Scrolling the list moves the row away from its menu.
  document.addEventListener('scroll', closeContextMenu, true)
}

/** Open the menu under an element (from the keyboard). */
export function openContextMenuFor(target: HTMLElement, items: MenuItem[]) {
  const box = target.getBoundingClientRect()
  openContextMenu(box.left + 16, box.bottom, items)
}

/** Give an element a right-click menu (and the Menu key / Shift+F10). The items are
 * made when it opens, so they're up to date. */
export function withContextMenu(target: HTMLElement, items: () => MenuItem[]) {
  target.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    e.stopPropagation()
    openContextMenu(e.clientX, e.clientY, items())
  })
  target.addEventListener('keydown', (e) => {
    if (e.target !== target) return
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault()
      openContextMenuFor(target, items())
    }
  })
}
