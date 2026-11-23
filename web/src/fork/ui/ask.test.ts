import { describe, expect, test } from 'vitest'
import { askToConfirm } from './confirm.ts'

/** The question's window, its buttons, and how to close it. */
function shown() {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.oim-confirm-buttons button')]
  return { no: buttons[0], yes: buttons[1], backdrop: document.querySelector('.oim-modal-backdrop') }
}

describe('a question before something that cannot be undone', () => {
  test('its main button says yes, and the window goes', async () => {
    const answer = askToConfirm('Delete layer', 'Delete "Units"?', 'Delete')
    shown().yes.click()
    expect(await answer).toBe(true)
    expect(shown().backdrop).toBeNull()
  })

  test('Cancel says no', async () => {
    const answer = askToConfirm('Delete layer', 'Delete "Units"?', 'Delete')
    shown().no.click()
    expect(await answer).toBe(false)
  })

  test('closed beside its buttons (×, Escape): no', async () => {
    const answer = askToConfirm('Delete layer', 'Delete "Units"?', 'Delete')
    shown().backdrop!.classList.remove('visible')
    expect(await answer).toBe(false)
  })
})
