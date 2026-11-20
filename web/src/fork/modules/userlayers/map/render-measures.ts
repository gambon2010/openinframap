// Fork: My layers' measurements as map features (map/render.ts draws them into each
// layer's measure source): their lines, labels and marks (measure/features.ts), and a
// line of sight's stretches, green where the ground is seen, red where it's hidden
// (measure/sight.ts), once the backend has answered (each answer asked once per points
// and heights, kept here).
import { DEFAULT_COLOR, UserFeature, UserLayer } from '../model/model.ts'
import { Measurement } from '../measure/features.types.ts'
import type { TickView } from '../measure/ticks.types.ts'
import { measurementFeatures, measurementOf } from '../measure/features.ts'
import type { North } from '../../../core/north.ts'
import {
  DEFAULT_OBSERVER,
  DEFAULT_TARGET,
  HIDDEN_COLOUR,
  SEEN_COLOUR,
  fetchSight,
  sightKey,
  sightStretches,
  type SightResult
} from '../measure/sight.ts'
import { isMeasure } from './geometry.ts'

/** What the measurements are drawn for: the map's zoom and view (their marks), the
 * north bearings are from. */
export interface MeasureView {
  ticks: TickView
  north: North
}

export class MeasureDrawer {
  /** Lines of sight's answers by their points and heights (sightKey); null while
   * asked, or when the backend couldn't answer. */
  private sights = new Map<string, SightResult | null>()

  /** `redraw`: called when a line of sight's answer arrives. */
  constructor(private redraw: () => void) {}

  /** A layer's measurements as features; `changed`: one being dragged, drawn as it
   * is now; `conflicted`: items in conflict, marked. */
  layerFeatures(
    layer: UserLayer,
    view: MeasureView,
    conflicted: Set<string>,
    changed?: UserFeature
  ): GeoJSON.Feature[] {
    const features: GeoJSON.Feature[] = []
    for (const stored of layer.features.values()) {
      const f = changed?.id === stored.id ? changed : stored
      if (!isMeasure(f)) continue
      const m = measurementOf(f)
      if (!m) continue
      features.push(
        ...measurementFeatures(m, {
          north: view.north,
          ticks: view.ticks,
          properties: {
            fid: f.id,
            color: f.properties.color ?? DEFAULT_COLOR,
            ...(conflicted.has(f.id) ? { conflict: true } : {})
          }
        })
      )
      if (m.type === 'sight') features.push(...this.sightFeatures(f, m))
    }
    return features
  }

  /** A line of sight's stretches, once the backend has answered (asked now if not). */
  private sightFeatures(f: UserFeature, m: Measurement): GeoJSON.Feature[] {
    const [from, to] = [m.points[0], m.points[m.points.length - 1]]
    if (!from || !to || m.points.length < 2) return []
    const observer = Number(f.properties.observer ?? DEFAULT_OBSERVER)
    const target = Number(f.properties.target ?? DEFAULT_TARGET)
    const key = sightKey(from, to, observer, target)
    const result = this.sights.get(key)
    if (result === undefined) {
      this.sights.set(key, null)
      void fetchSight(from, to, observer, target).then((answer) => {
        if (!answer) return
        this.sights.set(key, answer)
        this.redraw()
      })
      return []
    }
    if (!result) return []
    return sightStretches(from, to, result).map((stretch) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: stretch.points },
      properties: { fid: f.id, color: stretch.seen ? SEEN_COLOUR : HIDDEN_COLOUR }
    }))
  }
}
