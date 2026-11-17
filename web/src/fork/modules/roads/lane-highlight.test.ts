import { describe, expect, it } from 'vitest'
import { lineFilter, stopsFilter } from './lane-highlight.ts'

describe('a highlighted tram or metro line', () => {
  it('is its lanes of its kind and letter', () => {
    expect(lineFilter('tram', 'B')).toEqual([
      'all',
      ['==', ['get', 'kind'], 'tram'],
      ['==', ['get', 'ref'], 'B']
    ])
  })

  it('shows the stops it calls at, by its whole letter (B, not BB)', () => {
    // A stop's lines are ",A,B,": a line is in it between commas.
    expect(stopsFilter('B')).toEqual(['in', ',B,', ['get', 'lines']])
  })
})
