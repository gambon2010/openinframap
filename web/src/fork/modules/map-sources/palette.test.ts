import { describe, expect, test } from 'vitest'
import baseLayers from '../../../style/style_base.ts'
import { PALETTE, paletteLayers } from './palette.ts'

describe("the background map's palette", () => {
  test("every layer it colours is upstream's (a renamed one would keep upstream's colour)", () => {
    const ids = new Set(baseLayers.map((l) => l.id))
    for (const [id] of paletteLayers()) expect(ids.has(id), id).toBe(true)
  })

  test('pale and washed out, yet each kind of area its own shade', () => {
    const shades = Object.values(PALETTE)
    for (const [, saturation, lightness] of shades) {
      expect(saturation).toBeLessThanOrEqual(35)
      expect(lightness).toBeGreaterThanOrEqual(80)
    }
    expect(new Set(shades.map((s) => s.join())).size).toBe(shades.length)
  })
})
