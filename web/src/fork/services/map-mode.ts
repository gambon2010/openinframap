// Fork: who has the map for now. A tool that takes the map over (measuring, drawing
// in My layers) enters a mode; one mode at a time: entering one ends the last.
// While a mode is on, clicks on map features don't open their details, and the
// mode gets the map's events. Escape ends it.
//
//   mapMode.enter({ name: 'my-tool', cursor: 'crosshair', click: (e) => ..., exit: () => ... })
//   mapMode.leave('my-tool')
//
// A module that sometimes takes a click without a mode (My layers, on its own items)
// says so with mapMode.claimClicks. Installed once, before the modules
// (fork/index.ts).
import type { Map, MapMouseEvent } from 'maplibre-gl'
import type { ForkContext } from '../types.ts'

export interface MapMode {
  name: string
  /** The cursor over the map meanwhile ("crosshair"). */
  cursor?: string
  /** false: a double-click is the mode's (finishing a line), not a zoom. */
  doubleClickZoom?: boolean
  click?(e: MapMouseEvent): void
  dblclick?(e: MapMouseEvent): void
  /** Right-click (the browser's menu doesn't open while a mode has one). */
  contextmenu?(e: MapMouseEvent): void
  mousemove?(e: MapMouseEvent): void
  /** A key pressed (not in a text field): true if the mode used it. */
  keydown?(e: KeyboardEvent): boolean | void
  /** The mode ended (left, Escape, or another mode entered): tidy up. */
  exit?(): void
}

let map: Map | undefined
let current: MapMode | null = null
const claims: ((e: MapMouseEvent) => boolean)[] = []

function end() {
  const mode = current
  if (!mode) return
  current = null
  if (map) {
    map.getCanvas().style.cursor = ''
    map.doubleClickZoom.enable()
  }
  mode.exit?.()
}

export const mapMode = {
  /** Once, with the map and upstream's click router. */
  install(m: Map, clickRouter: ForkContext['clickRouter']) {
    map = m
    // The click router calls handleClick for every click on its layers: a mode, or
    // a claim, keeps it from opening the feature's details.
    const router = clickRouter as unknown as { handleClick: (e: MapMouseEvent) => void }
    const handleClick = router.handleClick.bind(clickRouter)
    router.handleClick = (e) => {
      if (current || claims.some((claim) => claim(e))) return
      handleClick(e)
    }
    m.on('click', (e) => current?.click?.(e))
    m.on('dblclick', (e) => {
      if (!current?.dblclick) return
      e.preventDefault()
      current.dblclick(e)
    })
    m.on('contextmenu', (e) => {
      if (!current?.contextmenu) return
      e.preventDefault()
      e.originalEvent.preventDefault()
      current.contextmenu(e)
    })
    m.on('mousemove', (e) => current?.mousemove?.(e))
    document.addEventListener('keydown', (e) => {
      if (!current || (e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return
      if (current.keydown?.(e)) e.preventDefault()
      else if (e.key === 'Escape') {
        e.preventDefault()
        end()
      }
    })
  },

  /** Take the map over (the mode before, if any, ends first). */
  enter(mode: MapMode) {
    if (current && current !== mode) end()
    current = mode
    if (map) {
      map.getCanvas().style.cursor = mode.cursor ?? ''
      if (mode.doubleClickZoom === false) map.doubleClickZoom.disable()
      else map.doubleClickZoom.enable()
    }
  },

  /** Give the map back, if this mode has it (its exit() runs). */
  leave(name: string) {
    if (current?.name === name) end()
  },

  /** The mode on now (null: none). */
  get current(): string | null {
    return current?.name ?? null
  },

  /** Take some clicks without a mode: they don't open the feature's details. */
  claimClicks(claim: (e: MapMouseEvent) => boolean) {
    claims.push(claim)
  }
}
