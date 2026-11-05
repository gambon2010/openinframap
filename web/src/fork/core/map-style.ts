// Fork: pieces of MapLibre styles shared by modules (no UI).
import type { ExpressionSpecification } from 'maplibre-gl'

/** A filter: features of these geometry types ('Point', 'LineString', 'Polygon'...). */
export function geometryIs(...types: string[]): ExpressionSpecification {
  return ['in', ['geometry-type'], ['literal', types]] as ExpressionSpecification
}
