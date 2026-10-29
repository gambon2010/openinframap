// Fork: the shared panel chrome (fork/ui/panel.css): a title bar with a close
// button, and a body that scrolls.
import { t } from 'i18next'
import { el } from 'redom'
import './panel.css'

export function panelButton(label: string, text: string, onclick: () => void): HTMLButtonElement {
  const button = el('button.oim-panel-button', text, {
    type: 'button',
    title: label,
    'aria-label': label
  }) as HTMLButtonElement
  button.onclick = onclick
  return button
}

/** A panel element (closed: without the class "visible") with its title bar and body. */
export function makePanel(
  className: string,
  title: string,
  ...content: (HTMLElement | string)[]
): { panel: HTMLElement; body: HTMLElement } {
  const body = el('.oim-panel-body', ...content)
  const panel = el(
    `div.oim-panel.${className}`,
    { role: 'dialog', 'aria-label': title },
    el(
      '.oim-panel-header',
      el('h2', title),
      panelButton(t('panel.close', 'Close'), '×', () => panel.classList.remove('visible'))
    ),
    body
  )
  return { panel, body }
}
