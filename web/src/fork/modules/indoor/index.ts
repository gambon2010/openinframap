// Fork: buildings' interiors from OpenStreetMap (docs/plans/indoor-maps.md; the data:
// scripts/import-indoor.sh). What has a floor plan is tinted violet while building
// outlines are shown (underground places outside any building dashed, clicked for
// their own details); a building's details offer its floors (chips: one shown at a
// time, clicked again to hide it), the map under a floor shown hidden, and list
// what's inside it by floor; clicking a line pins it, on its floor.
import type { Map as MapLibreMap, MapGeoJSONFeature } from 'maplibre-gl'
import { el } from 'redom'
import { BACKEND_BASE_URL, OIM_TILES } from '../../config.ts'
import { buildingId, INTERIOR_PREFIX, isBuildingLayer, somePoint } from '../../core/buildings.ts'
import { t } from '../../core/i18n.ts'
import type { ForkModule } from '../../types.ts'
import { toggleChip } from '../../ui/chip.ts'
import { addDetailsExtra, detailsCard } from '../../ui/details.ts'
import { leftColumn } from '../../ui/left-column.ts'
import { coverFilter, floorFilter, floorName, withFloor, type ShownFloors } from './floors.ts'
import type { BuildingInside, InsideItem } from './indoor.types.ts'
import * as look from './indoor.constants.ts'
import { byFloor, firstLevel, itemLabel, whatOf } from './inside.ts'
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
  // The buildings' tint and outline, and the names: a click opens what's under them.
  labelLayers: () => [look.TINT_LAYER, look.TINT_OUTLINE_LAYER, look.PLACE_OUTLINE_LAYER, look.LABEL_LAYER],
  init: ({ map }) => {
    theMap = map
    addDetailsExtra((feature, content) => void addInside(feature, content))
  },
  popup: {
    html: (feature) => {
      if (feature.layer.id === look.PLACE_LAYER) return placeDetails(feature)
      return feature.layer.id.startsWith(INTERIOR_PREFIX) ? pieceDetails(feature) : undefined
    }
  }
}

/** A building's or underground place's floors and what's inside, under its details. */
async function addInside(feature: MapGeoJSONFeature, content: HTMLElement) {
  const building = interiorOf(feature)
  const at = somePoint(feature.geometry)
  if (building === undefined || !at) return
  const found = await insideOf(building, at)
  if (!content.isConnected || (!found.levels.length && !found.inside.length)) return
  const floors = el('.oim-indoor-floors')
  const drawFloors = () => floors.replaceChildren(...floorChips(building, found.levels, drawFloors))
  drawFloors()
  const list = insideList(found.inside, (item) => {
    leftColumn.highlight.showPoint(item.at[0], item.at[1])
    const level = firstLevel(item)
    if (level !== null && found.levels.includes(level)) {
      showFloor(building, level)
      drawFloors()
    }
  })
  content.append(...(found.levels.length ? [floors] : []), ...(found.inside.length ? [list] : []))
}

/** The building (the background map's id) or underground place (negative) a clicked
 * feature is; undefined for anything else. */
function interiorOf(feature: MapGeoJSONFeature): number | undefined {
  if (isBuildingLayer(feature.layer.id)) return buildingId(feature)
  if (feature.layer.id === look.PLACE_LAYER) return Number(feature.properties.building_id)
  return undefined
}

/** Its floors and what's inside (the backend's /indoor/building); none when the
 * backend is out of reach. */
async function insideOf(building: number, at: [number, number]): Promise<BuildingInside> {
  const none: BuildingInside = { levels: [], inside: [] }
  try {
    const query = new URLSearchParams({ lon: String(at[0]), lat: String(at[1]) })
    const response = await fetch(`${BACKEND_BASE_URL}/indoor/building/${building}?${query}`)
    return response.ok ? ((await response.json()) as BuildingInside) : none
  } catch {
    // Out of reach: the details as they are.
    return none
  }
}

/** "Floor": a chip a floor, the one shown lit; clicked again, hidden. */
function floorChips(building: number, levels: number[], redraw: () => void): HTMLElement[] {
  return [
    el('span.oim-indoor-floors-label', t('indoor.floors', 'Floor')),
    el(
      '.oim-chips',
      levels.map((level) =>
        toggleChip(
          String(level),
          shown.get(building) === level,
          (on) => {
            showFloor(building, on ? level : null)
            redraw()
          },
          floorLabel(level)
        )
      )
    )
  ]
}

/** "What's inside", a floor at a time; a line clicked: `pin`. */
function insideList(items: InsideItem[], pin: (item: InsideItem) => void): HTMLElement {
  const groups = byFloor(items).map((group) =>
    el(
      '.oim-indoor-group',
      el(
        'h4',
        group.level === null ? t('indoor.floor-not-given', 'Floor not given') : floorLabel(group.level)
      ),
      group.lines.map(({ item, count }) => {
        // Its name (×4 for four alike), then what it is when known.
        const name = count > 1 ? `${itemLabel(item)} ×${count}` : itemLabel(item)
        const what = whatOf(item)
        const line = el(
          'button.oim-indoor-item',
          { type: 'button' },
          el('span', name),
          ...(what ? [el('small', what)] : [])
        ) as HTMLButtonElement
        line.onclick = () => pin(item)
        return line
      })
    )
  )
  return el('section.oim-indoor-inside', el('h3', t('indoor.inside', 'What’s inside')), groups)
}

/** A building's floor drawn, the map under it hidden (null: its interior hidden). */
function showFloor(building: number, level: number | null) {
  shown = withFloor(shown, building, level)
  if (!theMap) return
  const filter = floorFilter(shown)
  for (const id of look.FLOOR_LAYERS) if (theMap.getLayer(id)) theMap.setFilter(id, filter)
  if (theMap.getLayer(look.COVER_LAYER)) theMap.setFilter(look.COVER_LAYER, coverFilter(shown))
}

function floorLabel(level: number): string {
  return floorName(level, {
    ground: t('indoor.ground-floor', 'Ground floor'),
    floor: t('indoor.floor-n', 'Floor {{n}}'),
    basement: t('indoor.basement-n', 'Basement {{n}}')
  })
}

/** An underground place outside any building: its name; its floors and what's inside
 * are added like a building's. */
function placeDetails(feature: MapGeoJSONFeature): HTMLElement {
  const name = feature.properties.name ? String(feature.properties.name) : undefined
  return detailsCard(name ?? t('indoor.underground-place', 'Underground place'), [
    [t('indoor.what', 'What'), name ? t('indoor.underground-place', 'Underground place') : undefined]
  ])
}

/** A room's or a corridor's details: what it is, its name and floor. */
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
    stairs: t('indoor.kind.stairs', 'Stairs'),
    escalator: t('indoor.kind.escalator', 'Escalator'),
    path: t('indoor.kind.path', 'Walkway')
  }
  return names[kind] ?? kind
}

export default indoor
