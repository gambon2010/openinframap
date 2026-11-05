import { beforeAll, describe, expect, test } from 'vitest'
import { NOT_IN_PICKER, VARIANTS, isDirection, variantsOf, withKey } from './graphic-variants.ts'
import { graphicsLibrary, mapScale, renderGraphic } from './graphics.ts'
import { searchCatalogue } from '../ui/palette.ts'
import { graphicKey } from './graphic-labels.ts'

type Lib = Awaited<ReturnType<typeof graphicsLibrary>>
let lib: Lib
beforeAll(async () => {
  lib = await graphicsLibrary()
}, 60_000)

describe('two versions of one graphic', () => {
  test('switching keeps the affiliation, the status and the rest of the code', () => {
    expect(withKey('GHTPB----------', 'G*M*OEB')).toBe('GHMPOEB--------')
    expect(withKey('GHMAOEB--------', 'G*T*B')).toBe('GHTAB----------')
    expect(withKey('GFGPOLAGM------', 'G*G*OLKGM')).toBe('GFGPOLKGM------')
  })

  test('which version a code is', () => {
    expect(variantsOf('GFTPB----------')?.index).toBe(0)
    expect(variantsOf('GHMPOEB--------')?.index).toBe(1)
    expect(variantsOf('GFGPOLKA-------')?.variants.arrow).toBe(true)
    expect(variantsOf('GFTPJ----------')).toBeNull()
  })

  test('the picker shows the first version only', () => {
    const keys = new Set(searchCatalogue('', 'graphics').map((e) => graphicKey(e[0])))
    for (const v of VARIANTS) {
      expect(keys.has(v.keys[0]), v.keys[0]).toBe(true)
      expect(keys.has(v.keys[1]), v.keys[1]).toBe(false)
    }
    expect(NOT_IN_PICKER.size).toBe(VARIANTS.length)
  })

  test('one engagement area', () => {
    expect(searchCatalogue('engagement area', 'graphics').length).toBe(1)
  })

  // Our path goes tail to tip; the renderer wants a direction's tip first.
  test.each(['GFGPOLKGM------', 'GFGPOLKGS------', 'GFGPOLKA-------', 'GFGPPF---------'])(
    '%s: the arrowhead at the end of the path',
    (sidc) => {
      expect(isDirection(sidc)).toBe(true)
      const path: [number, number][] = [
        [7.7, 48.58],
        [7.72, 48.58],
        [7.74, 48.58]
      ]
      const pieces = renderGraphic(lib, { sidc, points: [...path].reverse(), scale: mapScale(12, 48.58) })
      // The arrowhead: short strokes at the tip's end (east), none at the tail's (west).
      // (Aviation's mark in the middle of the shaft is short too.)
      const flat = (c: unknown): number[][] =>
        Array.isArray(c) && typeof c[0] === 'number' ? [c as number[]] : (c as unknown[]).flatMap(flat)
      const strokes = pieces.flatMap((p) =>
        p.geometry.type === 'MultiLineString'
          ? p.geometry.coordinates
          : p.geometry.type === 'LineString'
            ? [p.geometry.coordinates]
            : []
      )
      const short = strokes
        .map((s) => flat(s).map((c) => c[0]))
        .filter((xs) => Math.max(...xs) - Math.min(...xs) < 0.01)
      expect(short.some((xs) => Math.max(...xs) > 7.739)).toBe(true)
      expect(short.some((xs) => Math.min(...xs) < 7.705)).toBe(false)
    }
  )
})
