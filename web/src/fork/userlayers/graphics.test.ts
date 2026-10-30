// Tactical graphics through the real C5ISR renderer (no map needed: it returns GeoJSON).
import { beforeAll, describe, expect, test } from 'vitest'
import { colour, graphicsLibrary, haloFor, mapScale, pointCount, renderGraphic, toDCode } from './graphics.ts'

type Lib = Awaited<ReturnType<typeof graphicsLibrary>>
let lib: Lib

beforeAll(async () => {
  lib = await graphicsLibrary()
}, 60_000)

describe('helpers', () => {
  test('colours: alpha dropped, lower case', () => {
    expect(colour('#FF00FF00')).toBe('#00ff00')
    expect(colour('#FFFF00')).toBe('#ffff00')
    expect(colour('red')).toBeNull()
    expect(colour(undefined)).toBeNull()
  })

  test('labels get a dark outline on light text, white on dark', () => {
    expect(haloFor('#ffff00')).toBe('#1a1a1a') // yellow: unknown / pending
    expect(haloFor('#00ffff')).toBe('#1a1a1a')
    expect(haloFor('#000000')).toBe('#ffffff')
    expect(haloFor('#ff0000')).toBe('#ffffff') // hostile red
    expect(haloFor('#0000ff')).toBe('#ffffff')
  })

  test('map scale halves with each zoom level', () => {
    expect(mapScale(10, 0) / mapScale(11, 0)).toBeCloseTo(2)
    expect(mapScale(10, 60)).toBeCloseTo(mapScale(10, 0) / 2, 0)
  })
})

describe('the renderer', () => {
  test('2525C codes convert to 2525D', () => {
    expect(toDCode(lib, 'GFGPOLAGM------')).toMatch(/^\d{20,30}$/)
    expect(toDCode(lib, 'GFGPXXXXXX-----')).toBeNull()
  })

  test('how many points a graphic takes', () => {
    expect(pointCount(lib, 'GFTPB----------')).toEqual({ min: 3, max: 3 }) // block
    expect(pointCount(lib, 'GFGPGLP--------')?.min).toBe(2) // phase line
  })

  test('a phase line: lines and its label', () => {
    const features = renderGraphic(lib, {
      sidc: 'GFGPGLP--------',
      points: [
        [7.6, 48.6],
        [7.9, 48.62]
      ],
      modifiers: { T: 'RED' },
      scale: mapScale(11, 48.6)
    })
    const lines = features.filter((f) => f.geometry.type.endsWith('LineString'))
    const labels = features.filter((f) => f.geometry.type === 'Point').map((f) => f.properties?.label)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0].properties?.stroke).toMatch(/^#[0-9a-f]{6}$/)
    expect(labels.join(' ')).toContain('RED')
    // The metadata polygon isn't drawn.
    expect(features.every((f) => !('symbolID' in (f.properties ?? {})))).toBe(true)
  })

  test('an axis of advance with a colour of our own', () => {
    const features = renderGraphic(lib, {
      sidc: 'GHGPOLAGM------',
      points: [
        [7.6, 48.5],
        [7.7, 48.55],
        [7.72, 48.5]
      ],
      color: '#123456',
      scale: mapScale(11, 48.5)
    })
    expect(features.some((f) => f.properties?.stroke === '#123456')).toBe(true)
  })

  test('a code without an equivalent is an error', () => {
    expect(() => renderGraphic(lib, { sidc: 'GFGPXXXXXX-----', points: [[0, 0]], scale: 50_000 })).toThrow()
  })
})
