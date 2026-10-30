import { describe, expect, test } from 'vitest'
import { UserFeature } from './model.ts'
import { changedFields } from './history.ts'

const unit = (
  sidc: string,
  extra: Partial<UserFeature['properties']> = {},
  at = [7.75, 48.58]
): UserFeature => ({
  type: 'Feature',
  id: 'f',
  geometry: { type: 'Point', coordinates: at },
  properties: { kind: 'symbol', sidc, ...extra }
})

describe('changedFields', () => {
  test('identity, status and echelon, in words', () => {
    expect(changedFields(unit('SFGPUCI--------'), unit('SHGAUCI----F---'))).toEqual([
      'identity: Friend → Hostile',
      'status: Present → Planned',
      'echelon: None → Battalion / squadron'
    ])
  })

  test('descriptive fields by name', () => {
    const before = unit('SFGPUCI--------', { modifiers: { T: '2nd Bn' } })
    const after = unit('SFGPUCI--------', { modifiers: { T: '2nd Bn', M: '1st Bde', W: '301200ZOCT26' } })
    expect(changedFields(before, after)).toEqual(['higher formation', 'date-time group'])
  })

  test('a removed field counts', () => {
    const before = unit('SFGPUCI--------', { modifiers: { H: 'note' } })
    expect(changedFields(before, unit('SFGPUCI--------'))).toEqual(['additional information'])
  })

  test('moved, renamed, notes', () => {
    const before = unit('SFGPUCI--------', { name: 'a' })
    const after = unit('SFGPUCI--------', { name: 'b', notes: 'x' }, [7.76, 48.58])
    expect(changedFields(before, after)).toEqual(['name', 'notes', 'moved'])
  })

  test('nothing changed, or no previous version', () => {
    expect(changedFields(unit('SFGPUCI--------'), unit('SFGPUCI--------'))).toEqual([])
    expect(changedFields(undefined, unit('SFGPUCI--------'))).toEqual([])
  })
})
