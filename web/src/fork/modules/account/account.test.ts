import { describe, expect, it } from 'vitest'
import { sessionEnded } from './index.ts'
import { lockedReason } from './accounts.ts'

describe('sessionEnded', () => {
  const origin = 'http://host:8800'
  it('is a 401 from this site', () => {
    expect(sessionEnded('/userdata', 401, origin)).toBe(true)
    expect(sessionEnded('http://host:8800/tegola/maps/power/1/2/3.pbf', 401, origin)).toBe(true)
  })
  it('not logging in itself, another site, or another answer', () => {
    expect(sessionEnded('/auth/login', 401, origin)).toBe(false)
    expect(sessionEnded('https://openinframap.org/x', 401, origin)).toBe(false)
    expect(sessionEnded('/userdata', 403, origin)).toBe(false)
  })
})

describe('rights that cannot be changed are locked', () => {
  it('your own admin right and disabling, an admin being disabled', () => {
    expect(lockedReason({ name: 'me', is_admin: true }, 'is_admin', 'me')).not.toBe('')
    expect(lockedReason({ name: 'me', is_admin: true }, 'disabled', 'me')).not.toBe('')
    expect(lockedReason({ name: 'bob', is_admin: true }, 'disabled', 'me')).not.toBe('')
    expect(lockedReason({ name: 'bob', is_admin: true }, 'is_admin', 'me')).toBe('')
    expect(lockedReason({ name: 'bob', is_admin: false }, 'disabled', 'me')).toBe('')
  })
})
