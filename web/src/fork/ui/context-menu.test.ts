import { afterEach, expect, test, vi } from 'vitest'
import { closeContextMenu, menuJustDismissed, openContextMenu } from './context-menu.ts'

afterEach(() => {
  closeContextMenu()
  vi.useRealTimers()
})

test('a click elsewhere that closes the menu counts as only closing it, for a moment', () => {
  vi.useFakeTimers()
  openContextMenu(10, 10, [{ label: 'Rename', run: () => undefined }])
  expect(menuJustDismissed()).toBe(false)
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  expect(menuJustDismissed()).toBe(true)
  vi.advanceTimersByTime(1000)
  expect(menuJustDismissed()).toBe(false)
})
