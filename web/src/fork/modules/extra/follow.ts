// Fork: open data shown with the category it completes: the distribution networks
// (extra_power_…) with Power, the gas ones (extra_gas_…) with Oil & Natural Gas.
// They have no entry of their own in Data layers: their map layers take the
// visibility of their category's (the first map layer with its prefix), whenever the
// style changes (the switcher switching it, the address, the style loading).
import type { Map } from 'maplibre-gl'

/** [the open data's layer prefix, the category's layer prefix] */
export const FOLLOWS: [string, string][] = [
  ['extra_power', 'power_'],
  ['extra_gas', 'petroleum_']
]

/** The layers whose visibility differs from their category's, and what it should be. */
export function toFollow(
  layers: { id: string; visibility: string }[],
  follows = FOLLOWS
): [string, string][] {
  const out: [string, string][] = []
  for (const [own, category] of follows) {
    const leader = layers.find((l) => l.id.startsWith(category))
    if (!leader) continue
    for (const l of layers)
      if (l.id.startsWith(own) && l.visibility !== leader.visibility) out.push([l.id, leader.visibility])
  }
  return out
}

export function followCategories(map: Map) {
  const sync = () => {
    const layers = (map.getStyle()?.layers ?? []).map((l) => ({
      id: l.id,
      visibility: (map.getLayoutProperty(l.id, 'visibility') as string | undefined) ?? 'visible'
    }))
    // Only what differs: setting it fires styledata again, which then changes nothing.
    for (const [id, visibility] of toFollow(layers))
      map.setLayoutProperty(id, 'visibility', visibility as 'visible' | 'none')
  }
  map.on('styledata', sync)
  if (map.isStyleLoaded()) sync()
}
