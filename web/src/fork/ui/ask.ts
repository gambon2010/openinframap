// Fork: asking or telling the person something, in a window in the middle of the
// screen (ui/panel.ts's showModal), never the browser's own boxes at the top
// (window.confirm, prompt, alert): a question before something that can't be undone,
// a text to type (a name), a message. Their buttons say what each does, the main one
// last; closing the window (×, Escape, a click beside) is "no", "nothing" or "OK".
import { el } from 'redom'
import { t } from '../core/i18n.ts'
import { showModal } from './panel.ts'

/** Asks; true if the person chose `confirm`. */
export function askToConfirm(
  title: string,
  message: string,
  confirm: string,
  cancel = t('panel.cancel', 'Cancel')
): Promise<boolean> {
  const no = el('button.oim-button', cancel, { type: 'button' }) as HTMLButtonElement
  const yes = el('button.oim-button.primary', confirm, { type: 'button' }) as HTMLButtonElement
  const question = showModal(title, el('p', message), el('.oim-ask-buttons', no, yes))
  yes.focus()
  return new Promise((answer) => {
    yes.onclick = () => {
      answer(true)
      question.close()
    }
    no.onclick = () => question.close()
    // Closed any other way, or by Cancel: no (an answer already given stays).
    void question.closed.then(() => answer(false))
  })
}

/** Asks for a text (a name), `initial` typed in and selected; null if not given. */
export function askForText(
  title: string,
  label: string,
  initial = '',
  confirm = t('panel.ok', 'OK')
): Promise<string | null> {
  const input = el('input', { type: 'text', value: initial }) as HTMLInputElement
  const no = el('button.oim-button', t('panel.cancel', 'Cancel'), { type: 'button' }) as HTMLButtonElement
  const yes = el('button.oim-button.primary', confirm, { type: 'button' }) as HTMLButtonElement
  const question = showModal(title, el('label.oim-ask-text', label, input), el('.oim-ask-buttons', no, yes))
  input.focus()
  input.select()
  return new Promise((answer) => {
    const given = () => {
      const text = input.value.trim()
      answer(text || null)
      question.close()
    }
    yes.onclick = given
    input.onkeydown = (event) => {
      if (event.key === 'Enter') given()
    }
    no.onclick = () => question.close()
    void question.closed.then(() => answer(null))
  })
}

/** Tells the person something; settles once they've closed it. */
export function tell(message: string, title = t('panel.note', 'Note')): Promise<void> {
  const ok = el('button.oim-button.primary', t('panel.ok', 'OK'), { type: 'button' }) as HTMLButtonElement
  const note = showModal(title, el('p', message), el('.oim-ask-buttons', ok))
  ok.onclick = () => note.close()
  ok.focus()
  return note.closed
}
