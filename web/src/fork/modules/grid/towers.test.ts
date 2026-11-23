import { describe, expect, it } from 'vitest'
import { describeTower } from './towers.ts'

describe('describeTower', () => {
  it('names the line and where it is counted from', () => {
    expect(
      describeTower({
        number: '23a',
        total: 61,
        voltage_kv: 225,
        name: 'Liaison 225 kV A - B',
        start: 'Poste A',
        end: 'Poste B'
      })
    ).toBe('Tower 23a of 61 on Liaison 225 kV A - B (225 kV), counted from Poste A.')
  })

  it('uses the stations for an unnamed line', () => {
    expect(describeTower({ number: '1', total: 2, voltage_kv: 63, name: null, start: 'A', end: 'B' })).toBe(
      'Tower 1 of 2 on A – B (63 kV), counted from A.'
    )
    expect(describeTower({ number: '1', total: 2, voltage_kv: 63, name: null, start: null, end: null })).toBe(
      'Tower 1 of 2 on a line (63 kV).'
    )
  })
})
