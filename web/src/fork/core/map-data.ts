// Fork: map data the tiles don't give (backend: web-backend/src/fork/map_data.py).
// A relative URL: the dev server proxies /userdata to the backend (vite.config.ts).

/**
 * The whole geometry of a map feature, by its tile layer and id: tiles have big
 * areas and long lines cut at their edges, and simplified at low zoom. Null if
 * the backend doesn't have it (or can't be reached).
 */
export async function sourceGeometry(layer: string, id: number): Promise<GeoJSON.Geometry | null> {
  try {
    const response = await fetch(`/userdata/source-feature?${new URLSearchParams({ layer, id: String(id) })}`)
    if (!response.ok) return null
    return (await response.json()).geometry
  } catch {
    return null
  }
}
