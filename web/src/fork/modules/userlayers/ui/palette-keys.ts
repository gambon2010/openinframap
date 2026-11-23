// Fork: moving through the picker's tiles with the arrow keys (palette.ts): from a
// tile to the next or previous one, or to the nearest in the row above or below
// (rows found by where the tiles are, so the favourites', recent and results' grids
// read as one). Pure.

/** Where a tile is on screen. */
export interface TilePlace {
  left: number
  top: number
}

/** The tile an arrow key leads to from tile `from`: its index; null for the search
 * box (up from the first row); undefined when the key isn't an arrow. */
export function nextTile(tiles: TilePlace[], from: number, key: string): number | null | undefined {
  switch (key) {
    case 'ArrowRight':
      return Math.min(from + 1, tiles.length - 1)
    case 'ArrowLeft':
      return Math.max(from - 1, 0)
    case 'ArrowUp':
      return nearestInRow(tiles, from, 'above') ?? null
    case 'ArrowDown':
      return nearestInRow(tiles, from, 'below') ?? from
    default:
      return undefined
  }
}

/** The tile in the next row above or below, nearest across; undefined if none. */
function nearestInRow(tiles: TilePlace[], from: number, side: 'above' | 'below'): number | undefined {
  const here = tiles[from]
  const inRows = tiles
    .map((tile, index) => ({ tile, index }))
    .filter(({ tile }) => (side === 'above' ? tile.top < here.top - 1 : tile.top > here.top + 1))
  if (!inRows.length) return undefined
  const tops = inRows.map(({ tile }) => tile.top)
  const rowTop = side === 'above' ? Math.max(...tops) : Math.min(...tops)
  const row = inRows.filter(({ tile }) => Math.abs(tile.top - rowTop) <= 1)
  const across = (index: number) => Math.abs(tiles[index].left - here.left)
  return row.map(({ index }) => index).reduce((best, index) => (across(index) < across(best) ? index : best))
}
