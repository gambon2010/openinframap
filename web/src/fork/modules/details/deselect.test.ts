import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { MapMouseEvent } from 'maplibre-gl'
import { DOUBLE_CLICK_MS, deselectOnEmptyClicks } from './deselect.ts'

type Handler = (e: MapMouseEvent) => void

let handlers: Record<string, Handler>
let open: boolean
let empty: boolean
const selection = { isOpen: () => open, close: vi.fn(() => (open = false)) }
const click = () => handlers.click({} as MapMouseEvent)
const dblclick = () => handlers.dblclick({} as MapMouseEvent)

beforeEach(() => {
  vi.useFakeTimers()
  handlers = {}
  open = true
  empty = true
  selection.close.mockClear()
  const map = { on: (type: string, handler: Handler) => (handlers[type] = handler) }
  deselectOnEmptyClicks(map as never, selection, () => empty)
})
afterEach(() => vi.useRealTimers())

test('a click on nothing deselects, once a double-click is ruled out', () => {
  click()
  expect(selection.close).not.toHaveBeenCalled()
  vi.advanceTimersByTime(DOUBLE_CLICK_MS)
  expect(selection.close).toHaveBeenCalledOnce()
})

test('a double-click zooms and keeps the selection', () => {
  click()
  click()
  dblclick()
  vi.advanceTimersByTime(DOUBLE_CLICK_MS)
  expect(selection.close).not.toHaveBeenCalled()
})

test('a feature clicked right after an empty click stays selected', () => {
  click()
  empty = false // the second click lands on a feature: it opens that one
  click()
  vi.advanceTimersByTime(DOUBLE_CLICK_MS)
  expect(selection.close).not.toHaveBeenCalled()
})

test('a click that does something (a feature, a tool, closing a menu) keeps it', () => {
  empty = false
  click()
  vi.advanceTimersByTime(DOUBLE_CLICK_MS)
  expect(selection.close).not.toHaveBeenCalled()
})

test('nothing selected: nothing to do', () => {
  open = false
  click()
  vi.advanceTimersByTime(DOUBLE_CLICK_MS)
  expect(selection.close).not.toHaveBeenCalled()
})
