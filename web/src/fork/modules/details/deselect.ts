// Fork: a click on the map that does nothing else closes the details. Not:
// dragging the map (MapLibre sends no click), a double-click (it zooms), a click
// that only closed a right-click menu, a click a tool or My layers takes, a click
// on a feature or near a line (that selects it instead).
import type { Map, MapMouseEvent } from 'maplibre-gl'

// A first click waits this long before deselecting: a second one makes a
// double-click, which zooms and keeps the selection.
export const DOUBLE_CLICK_MS = 300

export interface Selection {
  isOpen(): boolean
  close(): void
}

/** `doesNothing(e)`: no feature, no line within reach, no tool, no menu closed. */
export function deselectOnEmptyClicks(
  map: Pick<Map, 'on'>,
  selection: Selection,
  doesNothing: (e: MapMouseEvent) => boolean
) {
  let waiting: ReturnType<typeof setTimeout> | undefined
  map.on('click', (e: MapMouseEvent) => {
    // Any click cancels a deselect still waiting (a feature clicked right after).
    clearTimeout(waiting)
    if (!selection.isOpen() || !doesNothing(e)) return
    waiting = setTimeout(() => selection.close(), DOUBLE_CLICK_MS)
  })
  map.on('dblclick', () => clearTimeout(waiting))
}
