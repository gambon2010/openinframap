// Fork: the images My layers' points are drawn with, added to the map before any
// feature uses them (upstream's SymbolLoader would report unknown ones as missing
// icons). An image's name is "<prefix>:<value>"; the kind with that prefix draws it
// (kinds/: milsym, userimg, user-marker).
import { Map } from 'maplibre-gl'
import { FeatureProps } from '../model/model.ts'
import { kindOf, kindOfImage } from '../kinds/index.ts'

const loading = new globalThis.Map<string, Promise<void>>()

/** The image name a point feature is drawn with (null: none). */
export function iconName(p: FeatureProps, layerColor: string): string | null {
  return kindOf(p).icon?.(p, layerColor) ?? null
}

/** Add an image to the map if it isn't there yet (once, however often it's asked for). */
export function ensureImage(map: Map, name: string): Promise<void> {
  if (map.hasImage(name)) return Promise.resolve()
  let promise = loading.get(name)
  if (!promise) {
    promise = ensureImageNow(map, name).finally(() => loading.delete(name))
    loading.set(name, promise)
  }
  return promise
}

async function ensureImageNow(map: Map, name: string) {
  const [prefix, ...rest] = name.split(':')
  const kind = kindOfImage(prefix)
  if (!kind?.images) return
  try {
    const { data, pixelRatio } = await kind.images.make(rest.join(':'))
    if (!map.hasImage(name)) map.addImage(name, data, { pixelRatio })
  } catch (e) {
    console.warn('My layers: could not draw', name, e)
  }
}
