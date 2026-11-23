import { describe, expect, test } from 'vitest'
import {
  identity,
  mobility,
  status,
  symbolKind,
  unitModifiers,
  withIdentity,
  withMobility,
  withStatus,
  withUnitModifiers
} from './sidc.ts'

describe('symbolKind', () => {
  test.each([
    ['SFGPUCI--------', 'unit'], // infantry
    ['SHGPEVAT-------', 'equipment'], // tank
    ['SFGPIUE---H----', 'installation'],
    ['EFFPA-----H----', 'installation'], // emergency management infrastructure
    ['EFIPAA---------', 'activity'], // incident
    ['OFVPA----------', 'activity'], // stability operations
    ['SFAPMF---------', 'equipment'], // aircraft
    ['SFFPA----------', 'unit'], // special operations forces
    ['GFGPOLAGM------', 'graphic']
  ])('%s is a %s', (sidc, kind) => {
    expect(symbolKind(sidc)).toBe(kind)
  })
})

describe('identity and status', () => {
  test('read and change their positions only', () => {
    const sidc = 'SFGPUCI----F---'
    expect(identity(sidc)).toBe('F')
    expect(status(sidc)).toBe('P')
    expect(withIdentity(sidc, 'H')).toBe('SHGPUCI----F---')
    expect(withStatus(sidc, 'A')).toBe('SFGAUCI----F---')
  })

  test('pad short codes before changing them', () => {
    expect(withStatus('SFGP', 'A')).toBe('SFGA-----------')
  })
})

describe('unit modifiers', () => {
  test('none', () => {
    expect(unitModifiers('SFGPUCI--------')).toEqual({
      echelon: '-',
      hq: false,
      taskForce: false,
      feint: false
    })
  })

  test('battalion headquarters', () => {
    expect(unitModifiers('SFGPUCI---AF---')).toEqual({
      echelon: 'F',
      hq: true,
      taskForce: false,
      feint: false
    })
  })

  test.each([
    [{ echelon: 'H', hq: false, taskForce: false, feint: false }, '-H'],
    [{ echelon: 'E', hq: true, taskForce: true, feint: false }, 'BE'],
    [{ echelon: 'F', hq: true, taskForce: true, feint: true }, 'DF'],
    [{ echelon: '-', hq: false, taskForce: true, feint: true }, 'G-']
  ])('%o is written as %s and read back', (modifiers, chars) => {
    const sidc = withUnitModifiers('SFGPUCI--------', modifiers)
    expect(sidc.slice(10, 12)).toBe(chars)
    expect(unitModifiers(sidc)).toEqual(modifiers)
  })

  test('an unknown echelon character reads as none', () => {
    expect(unitModifiers('SFGPUCI----Z---').echelon).toBe('-')
  })
})

describe('mobility', () => {
  test('read, change and unknown values', () => {
    expect(mobility('SFGPEVAT--MQ---')).toBe('MQ')
    expect(mobility('SFGPEVAT-------')).toBe('--')
    expect(mobility('SFGPEVAT--ZZ---')).toBe('--')
    expect(withMobility('SFGPEVAT-------', 'MO')).toBe('SFGPEVAT--MO---')
  })
})
