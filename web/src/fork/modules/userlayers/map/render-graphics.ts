// Fork: My layers' tactical graphics as map features (map/render.ts draws them into
// each layer's graphics source), by the C5ISR renderer (graphics/graphics.ts), sized
// for the map's scale and cut to the view, in their identity's colours (the renderer's:
// hostile red...; an item's own colour isn't used, so it can't contradict its identity).
import { UserFeature, UserLayer } from '../model/model.ts'
import { isDirection } from '../graphics/variants.ts'
import { axisControlPoints, graphicsLibrary, renderGraphic, squareUp } from '../graphics/graphics.ts'
import { modifiersToDraw } from '../model/fields.ts'
import { controlPoints, isGraphic } from './geometry.ts'

type Library = Awaited<ReturnType<typeof graphicsLibrary>>

/** What the graphics are drawn for: the map's scale, the view, the labels' level. */
export interface GraphicsView {
  scale: number
  bbox: [number, number, number, number]
  level: Parameters<typeof modifiersToDraw>[1]
}

/** The points the renderer is given for a graphic: an arrow's along its axis (with
 * its width), a direction's reversed (it's drawn from its tip), the others squared
 * up as their kind needs. */
function pointsToDraw(f: UserFeature): [number, number][] {
  const points = controlPoints(f.geometry)
  if (f.properties.axis || f.properties.axisWidth !== undefined)
    return axisControlPoints(points, f.properties.axisWidth)
  if (isDirection(f.properties.sidc!)) return [...points].reverse()
  return squareUp(f.properties.sidc!, points)
}

/** A layer's graphics as features; `changed`: one being dragged, drawn as it is now.
 * A graphic the renderer can't draw is left out (said in the console). */
export function graphicFeatures(
  lib: Library,
  layer: UserLayer,
  view: GraphicsView,
  changed?: UserFeature
): GeoJSON.Feature[] {
  const features: GeoJSON.Feature[] = []
  for (const stored of layer.features.values()) {
    const f = changed && stored.id === changed.id ? changed : stored
    if (!isGraphic(f) || !f.properties.sidc) continue
    try {
      const pieces = renderGraphic(lib, {
        sidc: f.properties.sidc,
        points: pointsToDraw(f),
        modifiers: modifiersToDraw(f.properties.modifiers, view.level),
        scale: view.scale,
        bbox: view.bbox
      })
      for (const piece of pieces) piece.properties = { ...piece.properties, fid: f.id }
      features.push(...pieces)
    } catch (e) {
      console.warn('My layers: could not draw graphic', f.properties.sidc, e)
    }
  }
  return features
}
