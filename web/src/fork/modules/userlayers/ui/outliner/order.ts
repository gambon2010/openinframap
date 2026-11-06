// Fork: My layers' list (outliner/index.ts): the layers' order, in folders, and where
// a dragged one goes (pure).
import type { UserLayer } from '../../model/model.ts'
import type { PersonalSettings } from '../../state/personal.ts'

/**
 * Layers in their order: the ones in `order` as there, the others (new) before them,
 * newest first.
 */
export function sortLayers(layers: UserLayer[], order: string[]): UserLayer[] {
  const rank = new Map(order.map((id, i) => [id, i]))
  const unknown = layers.filter((l) => !rank.has(l.id)).reverse()
  const known = layers.filter((l) => rank.has(l.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
  return [...unknown, ...known]
}

/**
 * Layers by folder: folders (sorted, with the empty ones given) with their
 * layers, then layers in no folder.
 */
export function byFolder(
  layers: UserLayer[],
  empty: Iterable<string> = [],
  folderOf: (layer: UserLayer) => string | null = (l) => l.style.folder?.trim() || null
): [folder: string | null, layers: UserLayer[]][] {
  const folders = new Map<string, UserLayer[]>([...empty].map((f): [string, UserLayer[]] => [f, []]))
  const loose: UserLayer[] = []
  for (const layer of layers) {
    const folder = folderOf(layer)
    if (folder) folders.set(folder, [...(folders.get(folder) ?? []), layer])
    else loose.push(layer)
  }
  const out: [string | null, UserLayer[]][] = [...folders]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([f, l]): [string, UserLayer[]] => [f, l])
  if (loose.length) out.push([null, loose])
  return out
}

/** The layers as the list shows them, top first: also the order they're drawn in
 * (the top one on top). */
export function layerOrder(layers: UserLayer[], personal: PersonalSettings): string[] {
  const sorted = sortLayers(layers, personal.data.order)
  return byFolder(sorted, [], (l) => personal.folderOf(l)).flatMap(([, ls]) => ls.map((l) => l.id))
}

/**
 * Move one layer just above or below another in an order (top first); the others
 * keep theirs.
 */
export function placed(order: string[], id: string, target: string, before: boolean): string[] {
  const rest = order.filter((x) => x !== id)
  const at = rest.indexOf(target)
  if (at < 0) return order
  rest.splice(before ? at : at + 1, 0, id)
  return rest
}
