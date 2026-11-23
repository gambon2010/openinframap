// Fork: what's inside a building (the backend's /indoor/building), grouped by floor
// for its details: what has a floor in floor order, the rest last (the background
// map's points of interest have none written). Pure.
import type { InsideItem } from './indoor.types.ts'

/** A floor's things: its level (null: not given) and its lines, in name order. */
export interface FloorGroup {
  level: number | null
  lines: InsideLine[]
}

/** A line of the list: things alike on one floor (the same name and kind: a station's
 * four "Gares" signs) as one, how many, the first's place. */
export interface InsideLine {
  item: InsideItem
  count: number
}

// The first floor a level names: "0", "-1", "0.5", "1;2" (1), "0-3" (0), "-2--1" (-2).
const FIRST_LEVEL = /^(-?\d+(?:\.\d+)?)/

/** The floor an item is listed under: the first its levels name. */
export function firstLevel(item: InsideItem): number | null {
  if (item.levels === null) return null
  const match = FIRST_LEVEL.exec(item.levels.trim())
  return match ? Number(match[1]) : null
}

export function byFloor(items: InsideItem[]): FloorGroup[] {
  const groups = new Map<number | null, InsideItem[]>()
  for (const item of items) {
    const level = firstLevel(item)
    groups.set(level, [...(groups.get(level) ?? []), item])
  }
  return [...groups.keys()].sort(floorOrder).map((level) => ({ level, lines: linesOf(groups.get(level)!) }))
}

/** A floor's things as lines: alike ones together, in name order. */
function linesOf(items: InsideItem[]): InsideLine[] {
  const lines = new Map<string, InsideLine>()
  for (const item of items) {
    const key = `${itemLabel(item)}|${item.what}`
    const line = lines.get(key)
    if (line) line.count++
    else lines.set(key, { item, count: 1 })
  }
  return [...lines.values()].sort((a, b) => itemLabel(a.item).localeCompare(itemLabel(b.item)))
}

/** What a line says after the name: what it is, unless that's unknown ("poi"). */
export function whatOf(item: InsideItem): string | null {
  return item.name && item.what !== 'poi' ? whatName(item.what) : null
}

/** What a line says first: its name, else what it is ("fast_food" as "fast food"). */
export function itemLabel(item: InsideItem): string {
  return item.name ?? whatName(item.what)
}

/** What a thing is, as OpenStreetMap writes it, for reading: "fast food". */
export function whatName(what: string): string {
  return what.replaceAll('_', ' ')
}

/** Floors from the lowest; "not given" last. */
function floorOrder(a: number | null, b: number | null): number {
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}
