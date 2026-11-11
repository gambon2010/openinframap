import { describe, expect, it } from 'vitest'
import { readBackground } from './background.ts'

describe('the background kept in this browser', () => {
  it('reads what was kept, the high contrast map otherwise', () => {
    expect(readBackground(null, null)).toEqual({ colours: 'contrast', mode: 'map' })
    expect(readBackground('original', 'hybrid')).toEqual({ colours: 'original', mode: 'hybrid' })
    expect(readBackground('nonsense', 'nonsense')).toEqual({ colours: 'contrast', mode: 'map' })
  })
})

describe('a paint property that follows the background', () => {
  it('dark on the map, white on imagery, after each change', async () => {
    const { background, followBackground } = await import('./background.ts')
    const set: unknown[] = []
    const map = {
      getLayer: () => ({}),
      setPaintProperty: (_id: string, _name: string, value: unknown) => set.push(value),
      on: () => undefined
    }
    background.choose('contrast')
    followBackground(map as never, 'outline', 'line-color', { map: 'dark', imagery: 'white' })
    expect(set.at(-1)).toBe('dark')
    // Imagery chosen before it's known to exist: the map still, then imagery once there.
    background.choose('satellite')
    expect(set.at(-1)).toBe('dark')
    background.offerImagery({ maxzoom: 13, covers: async () => true })
    expect(set.at(-1)).toBe('white')
    background.choose('original')
    expect(set.at(-1)).toBe('dark')
  })
})
