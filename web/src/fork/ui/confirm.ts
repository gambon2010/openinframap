// Fork: a question before something that can't be undone (deleting a layer,
// discarding changes): a window in the middle of the screen (ui/panel.ts, not the
// browser's own box at the top), its two buttons saying what each does.
import { el } from 'redom'
import { t } from '../core/i18n.ts'
import { showModal } from './panel.ts'

/** Asks; true if the person chose `confirm` (closing the window is no). */
export function askToConfirm(
  title: string,
  message: string,
  confirm: string,
  cancel = t('panel.cancel', 'Cancel')
): Promise<boolean> {
  const no = el('button.oim-button', cancel, { type: 'button' }) as HTMLButtonElement
  const yes = el('button.oim-button.primary', confirm, { type: 'button' }) as HTMLButtonElement
  const question = showModal(title, el('p', message), el('.oim-confirm-buttons', no, yes))
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
