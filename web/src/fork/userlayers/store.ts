// Fork: "My layers" state. Every edit is a Change: applied here at once, kept as
// unsaved (also in localStorage, so a reload or crash doesn't lose it) and sent
// with "Save", in order. The backend logs each one, which is the history that
// can be played back (history.ts).
import { Change, ChangeOp, FeatureProps, UserFeature, UserLayer, uuid, DEFAULT_COLOR } from './model.ts'
import { loadAll, saveChanges } from './api.ts'

const PENDING_KEY = 'oim-userlayers-pending'
const HIDDEN_KEY = 'oim-userlayers-hidden'
const AUTHOR_KEY = 'oim-userlayers-author'

function readStorage<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private window or storage blocked: kept until the page is closed.
  }
}

/** Apply a change to a set of layers (also used to replay the history). */
export function applyChange(layers: Map<string, UserLayer>, change: Change) {
  const data = change.data ?? {}
  switch (change.op) {
    case 'layer_create':
      layers.set(change.layer_id, {
        id: change.layer_id,
        name: data.name ?? 'Layer',
        style: data.style ?? {},
        features: new Map()
      })
      break
    case 'layer_update': {
      const layer = layers.get(change.layer_id)
      if (!layer) break
      if (data.name !== undefined) layer.name = data.name
      if (data.style !== undefined) layer.style = data.style
      break
    }
    case 'layer_delete':
      layers.delete(change.layer_id)
      break
    case 'feature_create':
    case 'feature_update': {
      const layer = layers.get(change.layer_id)
      if (!layer || !change.feature_id || !data.geometry || !data.properties) break
      layer.features.set(change.feature_id, {
        type: 'Feature',
        id: change.feature_id,
        geometry: data.geometry,
        properties: data.properties
      })
      break
    }
    case 'feature_delete':
      layers.get(change.layer_id)?.features.delete(change.feature_id ?? '')
      break
  }
}

export class Store {
  layers = new Map<string, UserLayer>()
  pending: Change[] = readStorage<Change[]>(PENDING_KEY, [])
  hidden = new Set<string>(readStorage<string[]>(HIDDEN_KEY, []))
  activeLayer: string | null = null
  loaded = false
  error: string | null = null
  private listeners: (() => void)[] = []

  onChange(listener: () => void) {
    this.listeners.push(listener)
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }

  get author(): string {
    return readStorage<string>(AUTHOR_KEY, '')
  }

  set author(name: string) {
    writeStorage(AUTHOR_KEY, name)
  }

  /** The saved layers, with the unsaved changes on top. */
  async load() {
    try {
      const data = await loadAll()
      this.layers = new Map(
        data.layers.map((layer) => [
          layer.id,
          {
            id: layer.id,
            name: layer.name,
            style: layer.style,
            features: new Map(layer.features.map((f) => [f.id, f]))
          }
        ])
      )
      for (const change of this.pending) applyChange(this.layers, change)
      this.error = null
    } catch (e) {
      this.error = String((e as Error).message ?? e)
    }
    if (!this.activeLayer || !this.layers.has(this.activeLayer)) {
      this.activeLayer = this.layers.keys().next().value ?? null
    }
    this.loaded = true
    this.notify()
  }

  private record(op: ChangeOp, layer_id: string, feature_id?: string, data?: Change['data']) {
    const change: Change = { op, layer_id, feature_id, data, made_at: new Date().toISOString() }
    applyChange(this.layers, change)
    this.pending.push(change)
    writeStorage(PENDING_KEY, this.pending)
    this.notify()
  }

  createLayer(name: string): string {
    const id = uuid()
    this.record('layer_create', id, undefined, { name, style: { color: DEFAULT_COLOR } })
    this.activeLayer = id
    this.notify()
    return id
  }

  updateLayer(id: string, changes: { name?: string; style?: UserLayer['style'] }) {
    this.record('layer_update', id, undefined, changes)
  }

  deleteLayer(id: string) {
    this.record('layer_delete', id)
    if (this.activeLayer === id) this.activeLayer = this.layers.keys().next().value ?? null
    this.notify()
  }

  addFeature(layerId: string, geometry: GeoJSON.Geometry, properties: FeatureProps): string {
    const id = uuid()
    this.record('feature_create', layerId, id, { geometry, properties })
    return id
  }

  updateFeature(layerId: string, feature: UserFeature) {
    this.record('feature_update', layerId, feature.id, {
      geometry: feature.geometry,
      properties: feature.properties
    })
  }

  deleteFeature(layerId: string, featureId: string) {
    this.record('feature_delete', layerId, featureId)
  }

  /** Move a feature to another layer (two changes: out of one, into the other). */
  moveFeature(featureId: string, toLayerId: string) {
    const from = this.layerOf(featureId)
    const feature = from?.features.get(featureId)
    if (!from || !feature || from.id === toLayerId || !this.layers.has(toLayerId)) return
    this.record('feature_delete', from.id, featureId)
    this.record('feature_create', toLayerId, featureId, {
      geometry: feature.geometry,
      properties: feature.properties
    })
  }

  /** Which layer a feature is in. */
  layerOf(featureId: string): UserLayer | undefined {
    for (const layer of this.layers.values()) if (layer.features.has(featureId)) return layer
    return undefined
  }

  setHidden(layerId: string, hidden: boolean) {
    if (hidden) this.hidden.add(layerId)
    else this.hidden.delete(layerId)
    writeStorage(HIDDEN_KEY, [...this.hidden])
    this.notify()
  }

  setActive(layerId: string) {
    this.activeLayer = layerId
    this.notify()
  }

  /** Send the unsaved changes; they're logged on the server for the history. */
  async save() {
    if (!this.pending.length) return
    await saveChanges(this.pending, this.author)
    this.pending = []
    writeStorage(PENDING_KEY, [])
    await this.load()
  }

  /** Forget the unsaved changes and go back to what's saved. */
  async discard() {
    this.pending = []
    writeStorage(PENDING_KEY, [])
    await this.load()
  }
}
