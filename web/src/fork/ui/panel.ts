// Fork: the shared panel chrome (fork/ui/panel.css): a title bar with a close
// button, and a body that scrolls.
import { t } from '../core/i18n.ts'
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

/**
 * A window over the page, on a dimmed backdrop (Settings, Print): closed by ×, a
 * click beside it or Escape.
 */
export function makeModal(
  title: string,
  ...content: (HTMLElement | string)[]
): { panel: HTMLElement; body: HTMLElement; open: () => void; close: () => void } {
  const { panel, body } = makePanel('oim-modal', title, ...content)
  const backdrop = el('.oim-modal-backdrop', panel)
  document.body.append(backdrop)
  const close = () => backdrop.classList.remove('visible')
  // The panel's close button hides the panel: hide the whole window instead.
  new MutationObserver(() => {
    if (!panel.classList.contains('visible')) close()
  }).observe(panel, { attributes: true, attributeFilter: ['class'] })
  backdrop.onclick = (event) => {
    if (event.target === backdrop) close()
  }
  backdrop.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close()
  })
  const open = () => {
    panel.classList.add('visible')
    backdrop.classList.add('visible')
  }
  return { panel, body, open, close }
}

/** A window opened once (a question, a setting of one thing): shown at once, and
 * taken off the page when it's closed (makeModal's stay, to be opened again);
 * `closed` settles then, however it was closed (a button, ×, Escape, a click beside). */
export function showModal(
  title: string,
  ...content: (HTMLElement | string)[]
): { close: () => void; closed: Promise<void> } {
  const { panel, open, close } = makeModal(title, ...content)
  const backdrop = panel.parentElement!
  const closed = new Promise<void>((done) => {
    new MutationObserver((_, observer) => {
      if (backdrop.classList.contains('visible')) return
      observer.disconnect()
      backdrop.remove()
      done()
    }).observe(backdrop, { attributes: true, attributeFilter: ['class'] })
  })
  open()
  return { close, closed }
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
