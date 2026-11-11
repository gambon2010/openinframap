import { describe, expect, it } from 'vitest'
import { throughGate } from './config.ts'

describe('throughGate', () => {
  const gate = 'http://192.168.1.20:8800'
  it('sends the local services through the gate', () => {
    expect(throughGate('http://localhost:7800/maps', gate)).toBe(`${gate}/tegola/maps`)
    expect(throughGate('http://localhost:8001', gate)).toBe(gate)
    expect(throughGate('http://127.0.0.1:8090/france/{z}/{x}/{y}.mvt', gate)).toBe(
      `${gate}/satellite/france/{z}/{x}/{y}.mvt`
    )
  })

  it('leaves other addresses alone', () => {
    expect(throughGate('https://openinframap.org/map', gate)).toBe('https://openinframap.org/map')
    expect(throughGate('http://localhost:2322/api', gate)).toBe('http://localhost:2322/api')
  })
})
