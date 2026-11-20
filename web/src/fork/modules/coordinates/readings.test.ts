import { describe, expect, test } from 'vitest'
import { formatDeclination, fromPoint } from './readings.ts'

describe('the coordinates box’s readings', () => {
  test('the declination: east in Alsace, west in Canada (WMM2025)', () => {
    expect(formatDeclination(7.3, 47.75, new Date('2026-11-02'))).toMatch(/^3\.\d° E$/)
    expect(formatDeclination(-75, 45, new Date('2026-11-02'))).toMatch(/° W$/)
  })

  test('from the last click: the distance and the bearing from the north chosen', () => {
    expect(fromPoint([7, 47], [7, 47.01], 'true')).toBe('1.11 km 000°T')
    expect(fromPoint([7, 47], [7.01, 47], 'true')).toBe('758 m 090°T')
    expect(fromPoint([7, 47], [7, 47.01], 'magnetic')).toMatch(/^1\.11 km 35\d°M$/)
  })
})
