import { describe, expect, it, vi } from 'vitest'
import type { Map } from 'maplibre-gl'
import { FADE_MS, fadeSwitcher, fadesOnItsOwn } from './fade.ts'

/** A map of one line layer, recording what's set. */
function fakeMap() {
  const layout: Record<string, Record<string, unknown>> = { power_line: { visibility: 'none' }, roads_x: {} }
  const paint: Record<string, Record<string, unknown>> = { power_line: { 'line-opacity': 0.8 }, roads_x: {} }
  const map = {
    getLayer: (id: string) => (layout[id] ? { type: 'line' } : undefined),
    getLayoutProperty: (id: string, p: string) => layout[id][p],
    setLayoutProperty: (id: string, p: string, v: unknown) => {
      layout[id][p] = v
      return map
    },
    getPaintProperty: (id: string, p: string) => paint[id][p],
    setPaintProperty: (id: string, p: string, v: unknown) => {
      paint[id][p] = v
    }
  }
  return { map: map as unknown as Map, layout, paint }
}

describe('data layers fading as their entry is ticked', () => {
  it('fade in from transparent to their own opacity, and out before they go', () => {
    vi.useFakeTimers()
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f))
    const { map, layout, paint } = fakeMap()
    let shown = true
    const switcher = {
      _updateVisibility: () => map.setLayoutProperty('power_line', 'visibility', shown ? 'visible' : 'none')
    }
    fadeSwitcher(map, switcher)
    switcher._updateVisibility()
    expect(layout.power_line.visibility).toBe('visible')
    expect(paint.power_line['line-opacity']).toBe(0) // transparent first
    frames.forEach((f) => f(0))
    expect(paint.power_line['line-opacity']).toBe(0.8)
    expect(paint.power_line['line-opacity-transition']).toEqual({ duration: FADE_MS, delay: 0 })
    shown = false
    switcher._updateVisibility()
    expect(layout.power_line.visibility).toBe('visible') // still fading out
    expect(paint.power_line['line-opacity']).toBe(0)
    vi.advanceTimersByTime(FADE_MS)
    expect(layout.power_line.visibility).toBe('none')
    expect(paint.power_line['line-opacity']).toBe(0.8) // its own again, for next time
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("keep a look another module set while they faded (the background's)", () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f))
    const { map, paint } = fakeMap()
    const switcher = { _updateVisibility: () => map.setLayoutProperty('power_line', 'visibility', 'visible') }
    fadeSwitcher(map, switcher)
    switcher._updateVisibility()
    // Imagery shown while it fades in: its look over imagery.
    map.setPaintProperty('power_line', 'line-opacity', 0.35)
    frames.forEach((f) => f(0))
    expect(paint.power_line['line-opacity']).toBe(0.35)
    vi.unstubAllGlobals()
  })

  it('leave the layers changing their own look as they are, and the map as it was', () => {
    const { map, layout, paint } = fakeMap()
    const set = map.setLayoutProperty
    fadesOnItsOwn('roads_')
    const switcher = { _updateVisibility: () => map.setLayoutProperty('roads_x', 'visibility', 'none') }
    fadeSwitcher(map, switcher)
    switcher._updateVisibility()
    expect(layout.roads_x.visibility).toBe('none')
    expect(paint.roads_x).toEqual({})
    expect(map.setLayoutProperty).toBe(set)
  })
})
