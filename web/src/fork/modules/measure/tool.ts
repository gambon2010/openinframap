// Fork: the measuring tool: the measurements kept (until removed; they aren't saved,
// My layers is for that) and the one being made. While a tool is on it has the map
// (ui/map-mode.ts): clicks add points, a double-click or Enter finishes, Backspace
// takes back a point, right-click drops the measurement being made (again: stops),
// Esc stops. What they come to and look like: features.ts; on the map: layers.ts.
import { Map, MapMouseEvent } from 'maplibre-gl'
import { mapMode } from '../../ui/map-mode.ts'
import { LngLat } from './geo.ts'
import { North } from './north.ts'
import { MeasureMode, Measurement, measurementFeatures } from './features.ts'
import { drawMeasurements } from './layers.ts'

const NORTH_KEY = 'oim-measure-north'

function rememberedNorth(): North {
  try {
    const value = localStorage.getItem(NORTH_KEY)
    return value === 'magnetic' || value === 'grid' ? value : 'true'
  } catch {
    return 'true'
  }
}

export class MeasureTool {
  mode: MeasureMode | null = null
  /** The points of the measurement being made. */
  points: LngLat[] = []
  cursor: LngLat | null = null
  done: Measurement[] = []
  /** Range rings' radii, metres. */
  radii = [1000, 5000, 10000]
  /** The north bearings are measured from (remembered in this browser). */
  north: North = rememberedNorth()
  private nextId = 1
  private listeners: (() => void)[] = []

  constructor(private map: Map) {
    // A new style (another background map) drops what was added here.
    map.on('style.load', () => this.draw())
  }

  onChange(listener: () => void) {
    this.listeners.push(listener)
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }

  /** The measurement being made, to the cursor. */
  get draft(): Measurement | null {
    if (!this.mode || !this.points.length) return null
    const points = this.cursor && this.mode !== 'rings' ? [...this.points, this.cursor] : this.points
    return { id: 0, kind: this.mode, points, radii: this.radii }
  }

  /** Bearings from another north (the labels change at once). */
  setNorth(north: North) {
    this.north = north
    try {
      localStorage.setItem(NORTH_KEY, north)
    } catch {
      // Not remembered.
    }
    this.draw()
    this.notify()
  }

  /** Start a tool (the same again: stop it). */
  start(mode: MeasureMode) {
    const again = this.mode === mode
    this.stop()
    if (again) return
    this.mode = mode
    mapMode.enter({
      name: 'measure',
      cursor: 'crosshair',
      doubleClickZoom: false,
      click: (e) => this.click(e),
      dblclick: () => this.finish(),
      contextmenu: () => this.cancel(),
      mousemove: (e) => this.move(e),
      keydown: (e) => this.key(e),
      exit: () => this.reset()
    })
    this.notify()
  }

  /** Stop the tool; what's being made is dropped. */
  stop() {
    mapMode.leave('measure')
  }

  /** The mode ended (stop, Esc, or another tool took the map). */
  private reset() {
    if (!this.mode) return
    this.mode = null
    this.points = []
    this.cursor = null
    this.draw()
    this.notify()
  }

  /** Drop the measurement being made (the tool stays on); nothing being made: stop. */
  cancel() {
    if (!this.points.length) return this.stop()
    this.points = []
    this.cursor = null
    this.draw()
    this.notify()
  }

  private key(e: KeyboardEvent): boolean {
    if (e.key === 'Enter') this.finish()
    else if (e.key === 'Backspace' && this.points.length) {
      this.points.pop()
      this.draw()
      this.notify()
    } else return false
    return true
  }

  private move(e: MapMouseEvent) {
    if (!this.points.length) return
    this.cursor = [e.lngLat.lng, e.lngLat.lat]
    this.draw()
    this.notify()
  }

  private click(e: MapMouseEvent) {
    if (!this.mode) return
    const p: LngLat = [e.lngLat.lng, e.lngLat.lat]
    if (this.mode === 'rings') {
      if (this.radii.length) this.keep({ kind: 'rings', points: [p], radii: [...this.radii] })
      return
    }
    // The two clicks of a double-click: one point.
    const last = this.points[this.points.length - 1]
    if (last) {
      const a = this.map.project(last)
      const b = this.map.project(p)
      if (Math.hypot(a.x - b.x, a.y - b.y) < 4) return
    }
    this.points.push(p)
    this.draw()
    this.notify()
  }

  /** The measurement being made is done (kept on the map); the tool stays on. */
  finish() {
    if (!this.mode || this.mode === 'rings') return
    if (this.points.length >= (this.mode === 'area' ? 3 : 2)) {
      this.keep({ kind: this.mode, points: this.points })
    }
    this.points = []
    this.cursor = null
    this.draw()
    this.notify()
  }

  private keep(m: Omit<Measurement, 'id'>) {
    this.done.push({ ...m, id: this.nextId++ })
    this.draw()
    this.notify()
  }

  remove(id: number) {
    this.done = this.done.filter((m) => m.id !== id)
    this.draw()
    this.notify()
  }

  clear() {
    this.done = []
    this.points = []
    this.draw()
    this.notify()
  }

  /** Draw everything again. */
  draw() {
    const draft = this.draft
    drawMeasurements(this.map, {
      type: 'FeatureCollection',
      features: [
        ...this.done.flatMap((m) => measurementFeatures(m, false, this.north)),
        ...(draft ? measurementFeatures(draft, true, this.north) : [])
      ]
    })
  }
}
