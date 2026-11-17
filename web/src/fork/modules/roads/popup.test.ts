import { describe, expect, it } from 'vitest'
import { railwayTitle, roadTitle, transitTitle } from './popup.ts'

describe('what a clicked road, railway or tram line is called', () => {
  it('a road by its number as signed and its name', () => {
    expect(roadTitle({ ref: 'M 35', shield_text: 'A35', name: 'Autoroute des Cigognes' })).toBe(
      'A35 – Autoroute des Cigognes'
    )
    expect(roadTitle({ ref: 'D 392', name: 'Route de Schirmeck' })).toBe('D 392 – Route de Schirmeck')
    expect(roadTitle({ name: 'Rue du Dôme' })).toBe('Rue du Dôme')
    expect(roadTitle({ kind: 'minor_road' })).toBe('Road')
  })

  it('a tram or metro line by its kind and letter', () => {
    expect(transitTitle({ kind: 'tram', ref: 'B', colour: '#009EE0' })).toBe('Tram B')
    expect(transitTitle({ kind: 'subway', ref: '1' })).toBe('Metro 1')
    expect(transitTitle({ kind: 'tram' })).toBe('Tram')
  })

  it('a railway by its name, else its reference', () => {
    expect(railwayTitle({ name: 'LGV Est européenne', ref: '005000' })).toBe('LGV Est européenne')
    expect(railwayTitle({ ref: '005000' })).toBe('005000')
  })
})
