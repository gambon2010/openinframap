import { describe, expect, test } from 'vitest'
import { parseMgrs, toMgrs } from '../../core/mgrs.ts'
import { bearing } from './geo.ts'
import { declination, fromNorth, gridConvergence, offset } from './north.ts'
import { legBearing } from './tool.ts'

describe('norths', () => {
  test('magnetic: about 3.4° east in Alsace (WMM2025), west in Canada', () => {
    expect(declination(7.3, 47.75, new Date('2026-11-02'))).toBeCloseTo(3.4, 0)
    expect(declination(-75, 45, new Date('2026-11-02'))).toBeLessThan(-10)
  })

  test("grid: none on a zone's central meridian; matches the MGRS grid itself", () => {
    expect(gridConvergence(9, 47.75)).toBeCloseTo(0, 6)
    // Grid north from a point: the point 1 km further up the grid (same easting).
    const ref = toMgrs(7.3, 47.75)!.split(' ')
    const up = `${ref[0]}${ref[1]}${ref[2]}${String(Number(ref[3]) + 1000).padStart(5, '0')}`
    const here = parseMgrs(ref.join(''))!
    const there = parseMgrs(up)!
    const trueBearingOfGridNorth = bearing([here.lng, here.lat], [there.lng, there.lat])
    const toEast = trueBearingOfGridNorth > 180 ? trueBearingOfGridNorth - 360 : trueBearingOfGridNorth
    expect(gridConvergence(7.3, 47.75)).toBeCloseTo(toEast, 1)
  })

  test('a bearing from another north', () => {
    expect(offset('true', 7.3, 47.75)).toBe(0)
    expect(fromNorth(10, 'true', 7.3, 47.75)).toBe(10)
    const magnetic = fromNorth(1, 'magnetic', 7.3, 47.75, new Date('2026-11-02'))
    // 1° true is about 357.6° magnetic (north passes 0).
    expect(magnetic).toBeGreaterThan(357)
    expect(magnetic).toBeLessThan(358.5)
  })

  test("a leg's label says which north", () => {
    expect(legBearing([7, 47], [7, 48], 'true')).toBe('000°T (0 mils)')
    expect(legBearing([7, 47], [7, 48], 'grid')).toMatch(/^\d{3}°G \(\d+ mils\)$/)
  })
})
