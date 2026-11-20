// Fork: what My layers' tools draw before anything is put down (map/tools.ts): the
// faint ghost of what a placing tool would place, a measurement or a graphic as it's
// drawn, and the line or area being drawn, in the overlays' sources (render.ts makes
// them: ensureOverlays).
import { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { DEFAULT_COLOR } from '../model/model.ts'
import { isDirection } from '../graphics/variants.ts'
import { ensureImage } from './icons.ts'
import { Measurement } from '../measure/features.types.ts'
import { measurementFeatures } from '../measure/features.ts'
import { measurePrefs } from '../../../services/measure-prefs.ts'
import {
  axisControlPoints,
  axisWidth,
  graphicsLibrary,
  mapScale,
  renderGraphic
} from '../graphics/graphics.ts'
import { DRAFT, GHOST, GRAPHIC_DRAFT } from './render.constants.ts'
import { GraphicDraft } from './render.types.ts'
import { graphicSpecs } from './layers.ts'

/** The points a graphic being drawn is given to the renderer: an arrow's along its
 * axis (its width at least 10 m, Shift + scroll changing it), a direction's reversed
 * (drawn from its tip), the others as clicked. */
function draftPoints(draft: GraphicDraft): [number, number][] {
  if (draft.axis) {
    const width = Math.max(10, axisWidth(draft.points) * (draft.widthFactor ?? 1))
    return axisControlPoints(draft.points, width)
  }
  return isDirection(draft.sidc) ? [...draft.points].reverse() : draft.points
}

export class Drafts {
  constructor(
    private map: MapLibreMap,
    /** Makes the overlays' sources if they aren't there yet (render.ts). */
    private ensureOverlays: () => void
  ) {}

  /** What a placing tool would put down (an icon: map/icons.ts), faint at a point;
   * null: nothing. */
  async ghost(icon: string | null, at: [number, number] | null, size = 1) {
    this.ensureOverlays()
    if (icon) await ensureImage(this.map, icon)
    const features: GeoJSON.Feature[] =
      icon && at
        ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: at }, properties: { icon, size } }]
        : []
    ;(this.map.getSource(GHOST) as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features
    })
  }

  /** A measurement being drawn (to the cursor), with its labels and marks. */
  measureDraft(m: Measurement) {
    this.ensureOverlays()
    // Its marks come once it's done.
    const features = measurementFeatures(m, {
      draft: true,
      north: measurePrefs.north,
      zoom: this.map.getZoom()
    })
    ;(this.map.getSource(DRAFT) as GeoJSONSource).setData({ type: 'FeatureCollection', features })
  }

  /** A graphic being drawn (an arrow, a boundary...), as it will look once done,
   * faint: its points so far and the cursor. Drawn once per frame at most (the
   * graphic is computed again as the mouse moves); null: none. */
  graphicDraft(draft: GraphicDraft | null) {
    this.pendingGraphic = draft
    if (this.graphicFrame) return
    this.graphicFrame = requestAnimationFrame(() => {
      this.graphicFrame = 0
      void this.drawGraphicDraft()
    })
  }

  private pendingGraphic: GraphicDraft | null = null
  private graphicFrame = 0

  private async drawGraphicDraft() {
    const draft = this.pendingGraphic
    const map = this.map
    this.ensureOverlays()
    if (!map.getSource(GRAPHIC_DRAFT)) {
      map.addSource(GRAPHIC_DRAFT, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      for (const spec of graphicSpecs(GRAPHIC_DRAFT, DEFAULT_COLOR, 0.6)) map.addLayer(spec)
    }
    const source = map.getSource(GRAPHIC_DRAFT) as GeoJSONSource
    if (!draft) {
      source.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    // In the colour of the layer it goes into.
    map.setPaintProperty(`${GRAPHIC_DRAFT}_line`, 'line-color', ['coalesce', ['get', 'stroke'], draft.colour])
    const lib = await graphicsLibrary()
    if (this.pendingGraphic !== draft) return // something newer
    const bounds = map.getBounds()
    let pieces: GeoJSON.Feature[] = []
    try {
      pieces = renderGraphic(lib, {
        sidc: draft.sidc,
        points: draftPoints(draft),
        modifiers: {},
        scale: mapScale(map.getZoom(), map.getCenter().lat),
        bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
      })
    } catch {
      // Not drawable with these points (yet): nothing.
    }
    source.setData({ type: 'FeatureCollection', features: pieces })
  }

  /** The shape being drawn (line/area tools); cursor: where the line goes on to
   * (no point drawn there: none has been put down yet); line: false, the points only. */
  draft(points: [number, number][], closed: boolean, cursor?: [number, number], line = true) {
    this.ensureOverlays()
    const coordinates = cursor && points.length ? [...points, cursor] : points
    const features: GeoJSON.Feature[] = points.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: c },
      properties: {}
    }))
    if (line && coordinates.length > 1) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: closed ? [...coordinates, coordinates[0]] : coordinates
        },
        properties: {}
      })
    }
    ;(this.map.getSource(DRAFT) as GeoJSONSource).setData({ type: 'FeatureCollection', features })
  }
}
