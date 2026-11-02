// Fork: the kinds of item My layers has (types.ts says what a kind defines).
import { FeatureProps } from '../model/model.ts'
import { copy } from './copy.ts'
import { drawing } from './drawing.ts'
import { graphic } from './graphic.ts'
import { image } from './image.ts'
import { marker } from './marker.ts'
import { symbol } from './symbol.ts'
import { ItemKind } from './types.ts'

export const KINDS: ItemKind[] = [symbol, graphic, image, marker, drawing, copy]

const BY_ID = new Map(KINDS.map((k) => [k.id as string, k]))

/** The kinds' ids ("symbol", "marker"...). */
export const KIND_IDS = KINDS.map((k) => k.id as string)

/** An item's kind (unknown ones, from a newer version: drawn as a drawing). */
export function kindOf(p: Pick<FeatureProps, 'kind'>): ItemKind {
  return BY_ID.get(p.kind) ?? drawing
}

/** The kind whose images have this prefix ("milsym" in "milsym:SFG..."). */
export function kindOfImage(prefix: string): ItemKind | undefined {
  return KINDS.find((k) => k.images?.prefix === prefix)
}

export type { ItemKind, Item, KindFilter, SymbolRender } from './types.ts'
