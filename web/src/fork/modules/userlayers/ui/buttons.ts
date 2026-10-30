// Fork: My layers' buttons (toolbar, timeline): a label or glyph, and a look.
import { el } from 'redom'

export function action(
  label: string,
  onclick: () => void,
  options: {
    title?: string
    disabled?: boolean
    primary?: boolean
    active?: boolean
    className?: string
  } = {}
): HTMLButtonElement {
  const button = el(
    `button.oim-ul-button${options.primary ? '.primary' : ''}${options.active ? '.active' : ''}${options.className ? '.' + options.className : ''}`,
    label,
    { type: 'button', title: options.title ?? '', disabled: options.disabled ?? false }
  ) as HTMLButtonElement
  button.onclick = onclick
  return button
}
