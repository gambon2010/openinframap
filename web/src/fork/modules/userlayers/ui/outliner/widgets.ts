// Fork: My layers' list (outliner/index.ts): the list's small pieces: an icon button, a row reachable with Tab.
import { el } from 'redom'
import type { OutlinerContext } from './types.ts'

export function button(label: string | Element, onclick: () => void, title = '', className = '') {
  const b = el(`button.oim-ul-button.oim-ul-icon${className ? '.' + className : ''}`, label, {
    type: 'button',
    title,
    'aria-label': title || (typeof label === 'string' ? label : '')
  }) as HTMLButtonElement
  b.onclick = (e) => {
    e.stopPropagation()
    onclick()
  }
  return b
}

/** A row reachable with Tab: Enter or Space does what a click does. */
export function focusable(c: OutlinerContext, row: HTMLElement, key: string) {
  row.tabIndex = 0
  row.dataset.key = key
  row.addEventListener('keydown', (e) => {
    if (e.target !== row || (e.key !== 'Enter' && e.key !== ' ')) return
    e.preventDefault()
    c.focusKey = key
    row.click()
  })
  row.addEventListener('focus', () => (c.focusKey = key))
}
