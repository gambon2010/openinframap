// Fork: where the hill shading goes among the map's layers (docs/STYLE.md).

/** The background map's first layers to come over the hill shading: its roads
 * (tunnels first) and buildings; the land cover and water stay under it, the
 * labels and data layers come later anyway. */
const OVER_SHADING = /^osm_(roads_|buildings)/
/** The background map's and the imagery's layers (with the terrain's own). */
const BACKGROUND_OR_IMAGERY = /^(osm_|boundaries_|satellite_|terrain_)/

/** The layer the hill shading goes under: over the map, the first of the background
 * map's roads or buildings; over imagery, the first data layer (right above
 * the photos, which modules/satellite puts over the background map). undefined: the
 * top. */
export function hillshadeBefore(layerIds: string[], overImagery: boolean): string | undefined {
  return overImagery
    ? layerIds.find((id) => !BACKGROUND_OR_IMAGERY.test(id))
    : layerIds.find((id) => OVER_SHADING.test(id))
}
