import { describe, expect, test } from 'vitest'
import { nextTile } from './palette-keys.ts'

// Two rows of three tiles, then a shorter grid (another section) of one.
const tiles = [
  { left: 0, top: 0 },
  { left: 100, top: 0 },
  { left: 200, top: 0 },
  { left: 0, top: 50 },
  { left: 100, top: 50 },
  { left: 200, top: 50 },
  { left: 0, top: 130 }
]

describe('the arrow keys among the picker’s tiles', () => {
  test('right and left: the next and previous, stopping at the ends', () => {
    expect(nextTile(tiles, 1, 'ArrowRight')).toBe(2)
    expect(nextTile(tiles, 6, 'ArrowRight')).toBe(6)
    expect(nextTile(tiles, 0, 'ArrowLeft')).toBe(0)
  })

  test('down and up: the nearest across in the next row', () => {
    expect(nextTile(tiles, 1, 'ArrowDown')).toBe(4)
    expect(nextTile(tiles, 5, 'ArrowDown')).toBe(6)
    expect(nextTile(tiles, 6, 'ArrowUp')).toBe(3)
  })

  test('up from the first row: the search box; down from the last: stays', () => {
    expect(nextTile(tiles, 2, 'ArrowUp')).toBeNull()
    expect(nextTile(tiles, 6, 'ArrowDown')).toBe(6)
  })

  test('another key: not ours', () => {
    expect(nextTile(tiles, 0, 'a')).toBeUndefined()
  })
})
