import { describe, expect, test } from 'vitest'
import { askForText, askToConfirm, tell } from './ask.ts'

/** The question's window, its buttons, and how to close it. */
function shown() {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.oim-ask-buttons button')]
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

  test('a text typed and given; an empty one is nothing', async () => {
    const answer = askForText('Save situation', 'Name', 'Situation 1')
    const input = document.querySelector<HTMLInputElement>('.oim-ask-text input')!
    expect(input.value).toBe('Situation 1')
    input.value = '  Dawn  '
    shown().yes.click()
    expect(await answer).toBe('Dawn')
    const empty = askForText('Save situation', 'Name')
    shown().yes.click()
    expect(await empty).toBeNull()
  })

  test('a message settles once closed', async () => {
    let closed = false
    const told = tell('Nothing to import').then(() => (closed = true))
    expect(closed).toBe(false)
    document.querySelector<HTMLButtonElement>('.oim-ask-buttons button')!.click()
    await told
    expect(closed).toBe(true)
  })
})
