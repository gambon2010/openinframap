// Fork: the map layers of My layers' overlays, as MapLibre style definitions (pure:
// render.ts adds them, ensureOverlays): the selection (its outline, handles), what's
// being drawn (drafts.ts) and the faint ghost of what a placing tool would put down.
import { FilterSpecification, LayerSpecification } from 'maplibre-gl'
import {
  DRAFT,
  DRAFT_COLOUR,
  GHOST,
  HANDLE,
  HIGHLIGHT,
  MEASURE_LABEL_LAYOUT,
  POINT,
  SELECTION
} from './render.constants.ts'

/** The selection, draft and placing overlays' map layers (Renderer.ensureOverlays). */
export function overlayLayers(): LayerSpecification[] {
  return [
    {
      id: `${SELECTION}_line`,
      type: 'line',
      source: SELECTION,
      paint: {
        'line-color': HIGHLIGHT,
        // A picture, symbol or marker: a thin box around it.
        'line-width': ['case', ['==', ['get', 'outline'], true], 3, 8],
        'line-opacity': ['case', ['==', ['get', 'outline'], true], 1, 0.6]
      }
    },
    {
      // The points of a selected line, area or graphic: drag one to move it.
      id: `${SELECTION}_vertex`,
      type: 'circle',
      source: SELECTION,
      filter: ['all', POINT, ['==', ['get', 'vertex'], true]] as FilterSpecification,
      paint: {
        'circle-radius': 6,
        'circle-color': '#fff',
        'circle-stroke-color': HANDLE,
        'circle-stroke-width': 2
      }
    },
    {
      // Drag it to resize a picture, symbol or marker.
      id: `${SELECTION}_resize`,
      type: 'circle',
      source: SELECTION,
      filter: ['==', ['get', 'resize'], true],
      paint: {
        'circle-radius': 6,
        'circle-color': '#fff',
        'circle-stroke-color': HANDLE,
        'circle-stroke-width': 2
      }
    },
    {
      id: `${SELECTION}_point`,
      type: 'circle',
      source: SELECTION,
      filter: [
        'all',
        POINT,
        ['!=', ['get', 'vertex'], true],
        ['!=', ['get', 'resize'], true]
      ] as FilterSpecification,
      paint: {
        'circle-radius': 22,
        'circle-color': 'rgba(255, 214, 0, 0.15)',
        'circle-stroke-color': HIGHLIGHT,
        'circle-stroke-width': 3
      }
    },
    {
      id: `${DRAFT}_line`,
      type: 'line',
      source: DRAFT,
      paint: { 'line-color': DRAFT_COLOUR, 'line-width': 3, 'line-dasharray': [2, 1] }
    },
    {
      id: `${DRAFT}_point`,
      type: 'circle',
      source: DRAFT,
      filter: ['all', POINT, ['!', ['has', 'label']], ['!', ['has', 'tickLabel']]] as FilterSpecification,
      paint: {
        'circle-radius': 5,
        'circle-color': '#fff',
        'circle-stroke-color': DRAFT_COLOUR,
        'circle-stroke-width': 2
      }
    },
    {
      // What a placing tool would put down, faint, under the cursor.
      id: GHOST,
      type: 'symbol',
      source: GHOST,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': ['coalesce', ['get', 'size'], 1],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true
      },
      paint: { 'icon-opacity': 0.55 }
    },
    {
      // A measurement being drawn: its lengths and bearings so far.
      id: `${DRAFT}_label`,
      type: 'symbol',
      source: DRAFT,
      filter: ['has', 'label'],
      layout: MEASURE_LABEL_LAYOUT,
      paint: { 'text-color': DRAFT_COLOUR, 'text-halo-color': '#fff', 'text-halo-width': 2 }
    }
  ]
}
