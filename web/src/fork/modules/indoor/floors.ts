// Fork: which floor each building's interior is shown on (none at first): chosen in
// the building's details, as a map filter for the interior's layers. Pure.
import type { ExpressionSpecification } from 'maplibre-gl'

/** A floor layer's filter while no floor is chosen anywhere. */
export const NOTHING: ExpressionSpecification = ['boolean', false]

/** Building id to the floor shown. */
export type ShownFloors = ReadonlyMap<number, number>

/** The pieces to draw: in a building whose floor is chosen, on that floor (a piece
 * spans level_low to level_high: a staircase from 0 to 3 is on each). */
export function floorFilter(shown: ShownFloors): ExpressionSpecification {
  if (!shown.size) return NOTHING
  const onFloor = [...shown].map(([building, level]): ExpressionSpecification => [
    'all',
    ['==', ['get', 'building_id'], building],
    ['<=', ['get', 'level_low'], level],
    ['>=', ['get', 'level_high'], level]
  ])
  return ['any', ...onFloor]
}

/** `shown` with a building's floor chosen, or hidden (null). */
export function withFloor(shown: ShownFloors, building: number, level: number | null): Map<number, number> {
  const next = new Map(shown)
  if (level === null) next.delete(building)
  else next.set(building, level)
  return next
}

/** A floor as people say it: "Ground floor", "Floor 2", "Basement 1" (French and
 * OSM count the ground floor as 0). */
export function floorName(level: number, names: { ground: string; floor: string; basement: string }): string {
  if (level === 0) return names.ground
  if (level < 0) return names.basement.replace('{{n}}', String(-level))
  return names.floor.replace('{{n}}', String(level))
}
