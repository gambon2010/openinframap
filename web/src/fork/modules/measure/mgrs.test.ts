import { describe, expect, test } from 'vitest'
import { MgrsSearch } from './mgrs.ts'
import { parseMgrs, toMgrs } from '../../core/mgrs.ts'

describe('MGRS', () => {
  test('written in groups, to the precision asked', () => {
    expect(toMgrs(7.3, 47.75)).toMatch(/^32T LT \d{5} \d{5}$/)
    expect(toMgrs(7.3, 47.75, 3)).toMatch(/^32T LT \d{3} \d{3}$/)
    expect(toMgrs(0, 89)).toBeNull()
  })

  test('read back, however it is typed: the centre of its square', () => {
    const ref = toMgrs(7.3, 47.75)!
    for (const typed of [ref, ref.replace(/ /g, ''), ref.toLowerCase()]) {
      const found = parseMgrs(typed)!
      expect(found.lng).toBeCloseTo(7.3, 4)
      expect(found.lat).toBeCloseTo(47.75, 4)
      expect(found.size).toBe(1)
    }
    const coarse = parseMgrs(toMgrs(7.3, 47.75, 2)!)!
    expect(coarse.size).toBe(1000)
    expect(Math.abs(coarse.lng - 7.3)).toBeLessThan(0.02)
  })

  test("what isn't a grid reference", () => {
    for (const text of ['Lutterbach', '47.75, 7.3', '32TLT123', '32ILT1234', '61TLT1234', '']) {
      expect(parseMgrs(text)).toBeNull()
    }
  })

  test('the search box finds it', async () => {
    const [result] = await new MgrsSearch().search('32t lt 72577 89913')
    expect(result.name).toBe('32T LT 72577 89913')
    expect(result.score).toBe(1)
    expect(await new MgrsSearch().search('Mulhouse')).toEqual([])
  })
})
