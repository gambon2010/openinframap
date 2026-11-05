// Fork: several map features picked with Shift-click, to act on them together (the
// statuses: modules/status/selection.ts). The details module adds a Shift-clicked
// feature here instead of showing its details; anyone can listen to the changes.
import { MapGeoJSONFeature } from 'maplibre-gl'

/** A feature's tile layer and id ("power_line:123"); null without an id. */
export function featureId(feature: MapGeoJSONFeature): string | null {
  const id = feature.properties['osm_id'] ?? feature.properties['id']
  return feature.sourceLayer && id !== undefined && id !== null ? `${feature.sourceLayer}:${id}` : null
}

class Selection {
  private items = new Map<string, MapGeoJSONFeature>()
  private listeners: (() => void)[] = []
  /** Whether Shift is held (a click then picks instead of showing details). */
  shift = false

  constructor() {
    if (typeof window === 'undefined') return
    window.addEventListener('keydown', (e) => (this.shift = e.shiftKey))
    window.addEventListener('keyup', (e) => (this.shift = e.shiftKey))
    window.addEventListener('blur', () => (this.shift = false))
  }

  /** Add a feature, or take it out if it's in; false if it can't be picked (no id). */
  toggle(feature: MapGeoJSONFeature): boolean {
    const id = featureId(feature)
    if (!id) return false
    if (this.items.has(id)) this.items.delete(id)
    else this.items.set(id, feature)
    this.changed()
    return true
  }

  remove(id: string) {
    if (this.items.delete(id)) this.changed()
  }

  clear() {
    if (!this.items.size) return
    this.items.clear()
    this.changed()
  }

  get features(): [string, MapGeoJSONFeature][] {
    return [...this.items.entries()]
  }

  onChange(listener: () => void) {
    this.listeners.push(listener)
  }

  private changed() {
    for (const listener of this.listeners) listener()
  }
}

export const selection = new Selection()
