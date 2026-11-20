import { describe, expect, test } from 'vitest'
import { CONTOUR_LAYERS } from './contours.ts'
import { contoursKey } from './key.ts'

describe('the contour lines’ key', () => {
  test('unfolds under its entry, each tick box hiding one part of the lines', () => {
    const section = contoursKey('Contour lines')
    expect(section.title).toBe('Contour lines')
    for (const [, , hide] of section.rows) {
      const prefixes = (hide as { layers: string[] }).layers
      const hidden = CONTOUR_LAYERS.filter((id) => prefixes.some((prefix) => id.startsWith(prefix)))
      expect(hidden).toHaveLength(1)
    }
    expect(section.rows).toHaveLength(CONTOUR_LAYERS.length)
  })
})
