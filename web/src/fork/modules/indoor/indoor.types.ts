/** Something inside a building (the backend's /indoor/building): its name (null:
 * none, toilets), what it is ("bakery", "elevator"), its floors as written ("0", "1;2"; null: not given),
 * where it is (lon, lat). */
export interface InsideItem {
  name: string | null
  what: string
  levels: string | null
  at: [number, number]
}

/** A building's floors (none: no floor plan) and what's inside it. */
export interface BuildingInside {
  levels: number[]
  inside: InsideItem[]
}
