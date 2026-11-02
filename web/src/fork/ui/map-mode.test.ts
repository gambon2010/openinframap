import { describe, expect, test, vi } from 'vitest'
import { mapMode } from './map-mode.ts'

function fakeMap() {
  const handlers: Record<string, (e: unknown) => void> = {}
  const zoom = { enabled: true, enable: () => (zoom.enabled = true), disable: () => (zoom.enabled = false) }
  const canvas = { style: { cursor: '' } }
  return {
    handlers,
    zoom,
    canvas,
    map: {
      on: (name: string, h: (e: unknown) => void) => (handlers[name] = h),
      doubleClickZoom: zoom,
      getCanvas: () => canvas
    }
  }
}

const event = { preventDefault: () => undefined, originalEvent: { preventDefault: () => undefined } }

describe('the map mode', () => {
  test('one at a time; it gets the events, the cursor and double-click; feature clicks wait', () => {
    const { map, handlers, zoom, canvas } = fakeMap()
    const opened = vi.fn()
    const router = { handleClick: opened }
    mapMode.install(map as never, router as never)
    const clicks = vi.fn()
    const exitA = vi.fn()
    mapMode.enter({ name: 'a', cursor: 'crosshair', doubleClickZoom: false, click: clicks, exit: exitA })
    expect(mapMode.current).toBe('a')
    expect(canvas.style.cursor).toBe('crosshair')
    expect(zoom.enabled).toBe(false)
    handlers.click(event)
    expect(clicks).toHaveBeenCalledTimes(1)
    // A click on a feature doesn't open its details meanwhile.
    ;(router as unknown as { handleClick: (e: unknown) => void }).handleClick(event)
    expect(opened).not.toHaveBeenCalled()
    // Another mode: the first ends.
    mapMode.enter({ name: 'b' })
    expect(exitA).toHaveBeenCalledTimes(1)
    expect(zoom.enabled).toBe(true)
    // Leaving someone else's mode does nothing.
    mapMode.leave('a')
    expect(mapMode.current).toBe('b')
    mapMode.leave('b')
    expect(mapMode.current).toBeNull()
    expect(canvas.style.cursor).toBe('')
    ;(router as unknown as { handleClick: (e: unknown) => void }).handleClick(event)
    expect(opened).toHaveBeenCalledTimes(1)
  })

  test("Escape ends it, unless the mode uses the key; keys in a text field aren't its", () => {
    const { map } = fakeMap()
    mapMode.install(map as never, { handleClick: () => undefined } as never)
    const exit = vi.fn()
    mapMode.enter({ name: 'own-escape', keydown: (e) => e.key === 'Escape', exit })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(exit).not.toHaveBeenCalled()
    mapMode.enter({ name: 'plain', exit })
    const input = document.createElement('input')
    document.body.append(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(mapMode.current).toBe('plain')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(mapMode.current).toBeNull()
  })

  test('claimed clicks wait too', () => {
    const { map } = fakeMap()
    const opened = vi.fn()
    const router = { handleClick: opened }
    mapMode.install(map as never, router as never)
    mapMode.claimClicks((e) => (e as unknown as { mine?: boolean }).mine === true)
    const wrapped = router as unknown as { handleClick: (e: unknown) => void }
    wrapped.handleClick({ mine: true })
    expect(opened).not.toHaveBeenCalled()
    wrapped.handleClick({ mine: false })
    expect(opened).toHaveBeenCalledTimes(1)
  })
})
