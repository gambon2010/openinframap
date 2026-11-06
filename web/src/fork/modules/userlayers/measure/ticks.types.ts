// Fork: marks along a measured distance (ticks.ts): its types.

/** Where the marks are drawn: the zoom, and what's in view (none: everywhere). */
export interface TickView {
  zoom: number
  bounds?: { west: number; south: number; east: number; north: number }
}

export type XY = [number, number]

export interface Segment {
  a: XY
  b: XY
  start: number
  length: number
}
