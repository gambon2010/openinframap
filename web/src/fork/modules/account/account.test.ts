import { describe, expect, it } from 'vitest'
import { sessionEnded } from './index.ts'

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
