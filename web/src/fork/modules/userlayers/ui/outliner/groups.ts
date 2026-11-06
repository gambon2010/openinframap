// Fork: a layer's items in the list, sorted into groups that fold (ui/outliner):
// by side: friendly units and graphics, hostile units and graphics, neutral and
// unknown units and graphics; then measurements, drawings and markers, pictures,
// copies of map features. Empty groups aren't shown. Inside a group: what's
// present first, planned at the end; then by shape (arrows, lines, areas, points),
// then by type (all the attack arrows one after the other), then by name. Pure.
import { UserFeature } from '../../model/model.ts'
import { kindOf } from '../../kinds/index.ts'
import { featureLabelParts } from '../../model/labels.ts'
import { status } from '../../model/sidc.ts'
import type { ItemGroup } from './types.ts'
import { ITEM_GROUPS } from './constants.ts'

// Identities (2525C position 2): friend or assumed friend (and their exercise
// versions); hostile, suspect, joker, faker.
const FRIENDLY = new Set(['F', 'A', 'D', 'M'])
const HOSTILE = new Set(['H', 'S', 'J', 'K'])

function side(sidc: string | undefined): 'friendly' | 'hostile' | 'other' {
  const id = sidc?.[1] ?? ''
  return FRIENDLY.has(id) ? 'friendly' : HOSTILE.has(id) ? 'hostile' : 'other'
}

/** Which group an item goes in. */
export function groupOf(feature: UserFeature): ItemGroup {
  const p = feature.properties
  switch (kindOf(p).id) {
    case 'symbol':
      return `${side(p.sidc)}-units`
    case 'graphic':
      return `${side(p.sidc)}-graphics`
    case 'measure':
      return 'measurements'
    case 'image':
      return 'pictures'
    case 'copy':
      return 'copies'
    default:
      return 'drawings'
  }
}

/** Arrows, lines, areas, points: a graphic's or drawing's shape, to keep them together. */
function shapeRank(feature: UserFeature): number {
  if (feature.properties.axis) return 0
  const type = feature.geometry.type
  if (type.endsWith('LineString')) return 1
  if (type.endsWith('Polygon')) return 2
  return 3
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function compare(a: UserFeature, b: UserFeature): number {
  const planned = (f: UserFeature) => (f.properties.sidc && status(f.properties.sidc) === 'A' ? 1 : 0)
  const la = featureLabelParts(a)
  const lb = featureLabelParts(b)
  return (
    planned(a) - planned(b) ||
    shapeRank(a) - shapeRank(b) ||
    collator.compare(la.what, lb.what) ||
    collator.compare(la.name, lb.name) ||
    a.id.localeCompare(b.id)
  )
}

/** A layer's items by group (in the groups' order, empty ones left out), sorted. */
export function groupItems(items: UserFeature[]): [ItemGroup, UserFeature[]][] {
  const byGroup = new Map<ItemGroup, UserFeature[]>()
  for (const item of items) {
    const group = groupOf(item)
    byGroup.set(group, [...(byGroup.get(group) ?? []), item])
  }
  return ITEM_GROUPS.filter(([g]) => byGroup.has(g)).map(([g]) => [g, byGroup.get(g)!.sort(compare)])
}
