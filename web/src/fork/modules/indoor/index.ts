// Fork: buildings' interiors from OpenStreetMap (docs/plans/indoor-maps.md; the data:
// scripts/import-indoor.sh). Buildings with an interior are tinted while building
// outlines are shown; a building's details offer its floors, one at a time, and the
// chosen one is drawn (rooms, walls, doors, stairs, what's inside), each building on
// its own floor. Clicking a room or a door opens its details.
import type { Map as MapLibreMap, MapGeoJSONFeature } from 'maplibre-gl'
import { el } from 'redom'
import { BACKEND_BASE_URL, OIM_TILES } from '../../config.ts'
import { buildingId, INTERIOR_PREFIX, isBuildingLayer } from '../../core/buildings.ts'
import { t } from '../../core/i18n.ts'
import type { ForkModule } from '../../types.ts'
import { toggleChip } from '../../ui/chip.ts'
import { addDetailsExtra, detailsCard } from '../../ui/details.ts'
import { floorFilter, floorName, withFloor, type ShownFloors } from './floors.ts'
import * as look from './indoor.constants.ts'
import { indoorLayers } from './style.ts'
import './indoor.css'

let theMap: MapLibreMap | undefined
let shown: ShownFloors = new Map()

const indoor: ForkModule = {
  sources: () => ({
    [look.INDOOR_SOURCE]: {
      type: 'vector',
      tiles: [`${OIM_TILES}/indoor/{z}/{x}/{y}.pbf`],
      minzoom: look.INDOOR_MIN_ZOOM,
      maxzoom: look.INDOOR_MAX_ZOOM
    }
  }),
  layers: indoorLayers,
  // The tint and the names: a click opens the building or the room under them.
  labelLayers: () => [look.TINT_LAYER, look.LABEL_LAYER],
  init: ({ map }) => {
    theMap = map
    addDetailsExtra((feature, content) => void addFloorChoice(feature, content))
  },
  popup: {
    html: (feature) => (feature.layer.id.startsWith(INTERIOR_PREFIX) ? pieceDetails(feature) : undefined)
  }
}

/** A building's floors as chips under its details, if it has an interior. */
async function addFloorChoice(feature: MapGeoJSONFeature, content: HTMLElement) {
  if (!isBuildingLayer(feature.layer.id)) return
  const building = buildingId(feature)
  if (building === undefined) return
  const levels = await floorsOf(building)
  if (!levels.length || !content.isConnected) return
  const row = el('.oim-indoor-floors')
  const draw = () =>
    row.replaceChildren(
      el('span.oim-indoor-floors-label', t('indoor.floors', 'Inside, floor')),
      el(
        '.oim-chips',
        levels.map((level) =>
          toggleChip(
            String(level),
            shown.get(building) === level,
            (on) => {
              showFloor(building, on ? level : null)
              draw()
            },
            floorLabel(level)
          )
        )
      )
    )
  draw()
  content.append(row)
}

/** A building's floors (the backend's /indoor/building); [] when it has no interior
 * or the backend is out of reach. */
async function floorsOf(building: number): Promise<number[]> {
  try {
    const response = await fetch(`${BACKEND_BASE_URL}/indoor/building/${building}`)
    return response.ok ? ((await response.json()).levels as number[]) : []
  } catch {
    // Out of reach: no floor choice, the building's details as they are.
    return []
  }
}

/** A building's floor drawn (null: its interior hidden). */
function showFloor(building: number, level: number | null) {
  shown = withFloor(shown, building, level)
  const filter = floorFilter(shown)
  for (const id of look.FLOOR_LAYERS) if (theMap?.getLayer(id)) theMap.setFilter(id, filter)
}

function floorLabel(level: number): string {
  return floorName(level, {
    ground: t('indoor.ground-floor', 'Ground floor'),
    floor: t('indoor.floor-n', 'Floor {{n}}'),
    basement: t('indoor.basement-n', 'Basement {{n}}')
  })
}

/** A room's, a door's or a shop's details: what it is, its name and floor. */
function pieceDetails(feature: MapGeoJSONFeature): HTMLElement {
  const p = feature.properties
  const what = kindName(String(p.kind))
  const floors = String(p.levels)
    .split(';')
    .map((level) => (Number.isNaN(Number(level)) ? level : floorLabel(Number(level))))
    .join(', ')
  const floor =
    p.level_given === false ? t('indoor.floor-unknown', 'Not given (shown on the ground floor)') : floors
  return detailsCard(String(p.name || p.ref || what), [
    [t('indoor.what', 'What'), what],
    [t('indoor.ref', 'Number'), p.name && p.ref ? String(p.ref) : undefined],
    [t('indoor.floor', 'Floor'), floor]
  ])
}

function kindName(kind: string): string {
  const names: Record<string, string> = {
    room: t('indoor.kind.room', 'Room'),
    area: t('indoor.kind.area', 'Open area'),
    corridor: t('indoor.kind.corridor', 'Corridor'),
    level: t('indoor.kind.level', 'Floor outline'),
    wall: t('indoor.kind.wall', 'Wall'),
    column: t('indoor.kind.column', 'Column'),
    door: t('indoor.kind.door', 'Door'),
    stairs: t('indoor.kind.stairs', 'Stairs'),
    elevator: t('indoor.kind.elevator', 'Lift'),
    escalator: t('indoor.kind.escalator', 'Escalator'),
    path: t('indoor.kind.path', 'Walkway'),
    poi: t('indoor.kind.poi', 'Inside the building')
  }
  return names[kind] ?? kind
}

export default indoor
