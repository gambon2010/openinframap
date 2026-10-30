// Fork: "My layers" state. Every edit is a Change: applied here at once, kept as
// unsaved (also in localStorage, so a reload or crash doesn't lose it) and sent
// with "Save", in order. The backend logs each one, which is the history that
// can be played back (history.ts).
import { Change, ChangeOp, FeatureProps, UserFeature, UserLayer, uuid, DEFAULT_COLOR } from './model.ts'
import { loadAll, saveChanges } from './api.ts'

const PENDING_KEY = 'oim-userlayers-pending'
const HIDDEN_KEY = 'oim-userlayers-hidden'
const AUTHOR_KEY = 'oim-userlayers-author'
// How many saved steps undo can still take back.
const MAX_SAVED_STEPS = 200

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

/** What a saved step touched, as it was before: layers (name, style) and items. */
interface SavedStep {
  layers: Map<string, { name: string; style: UserLayer['style'] } | null>
  features: Map<string, { layerId: string; featureId: string; feature: UserFeature | null }>
}

/** The changes of `pending`, in steps: one change, or all of one batch. */
function steps(changes: Change[]): Change[][] {
  const out: Change[][] = []
  for (const change of changes) {
    const last = out[out.length - 1]
    if (last && change.batch && last[0].batch === change.batch) last.push(change)
    else out.push([change])
  }
  return out
}

function featureKey(layerId: string, featureId: string) {
  return `${layerId}/${featureId}`
}

/** Note how what `changes` touch is in `layers`, before they're applied. */
function beforeOf(layers: Map<string, UserLayer>, changes: Change[]): SavedStep {
  const step: SavedStep = { layers: new Map(), features: new Map() }
  const noteFeature = (layerId: string, featureId: string) => {
    const key = featureKey(layerId, featureId)
    if (!step.features.has(key))
      step.features.set(key, {
        layerId,
        featureId,
        feature: layers.get(layerId)?.features.get(featureId) ?? null
      })
  }
  for (const change of changes) {
    const layer = layers.get(change.layer_id)
    if (change.op.startsWith('layer_')) {
      if (!step.layers.has(change.layer_id))
        step.layers.set(change.layer_id, layer ? { name: layer.name, style: { ...layer.style } } : null)
      if (change.op === 'layer_delete' && layer)
        for (const id of layer.features.keys()) noteFeature(layer.id, id)
    } else if (change.feature_id) noteFeature(change.layer_id, change.feature_id)
  }
  return step
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The changes that bring what a step touched back to how it was before it. */
function restoring(layers: Map<string, UserLayer>, step: SavedStep, batch: string): Change[] {
  const made_at = new Date().toISOString()
  const created: Change[] = []
  const deleted: Change[] = []
  const gone = new Set<string>()
  for (const [id, before] of step.layers) {
    const now = layers.get(id)
    if (!before && now) {
      deleted.push({ op: 'layer_delete', layer_id: id, made_at, batch })
      gone.add(id)
    } else if (before && !now) {
      created.push({ op: 'layer_create', layer_id: id, data: { ...before }, made_at, batch })
    } else if (before && now && (before.name !== now.name || !same(before.style, now.style))) {
      created.push({ op: 'layer_update', layer_id: id, data: { ...before }, made_at, batch })
    }
  }
  const items: Change[] = []
  for (const { layerId, featureId, feature } of step.features.values()) {
    if (gone.has(layerId)) continue
    const now = layers.get(layerId)?.features.get(featureId)
    const data = feature ? { geometry: feature.geometry, properties: feature.properties } : undefined
    if (!feature && now)
      items.push({ op: 'feature_delete', layer_id: layerId, feature_id: featureId, made_at, batch })
    else if (feature && !now)
      items.push({ op: 'feature_create', layer_id: layerId, feature_id: featureId, data, made_at, batch })
    else if (
      feature &&
      now &&
      (!same(feature.geometry, now.geometry) || !same(feature.properties, now.properties))
    )
      items.push({ op: 'feature_update', layer_id: layerId, feature_id: featureId, data, made_at, batch })
  }
  return [...created, ...items, ...deleted]
}

type Redo = { changes: Change[] } | { saved: SavedStep; batch: string }

function cloneLayers(layers: Map<string, UserLayer>): Map<string, UserLayer> {
  return new Map(
    [...layers].map(([id, layer]) => [
      id,
      { ...layer, style: { ...layer.style }, features: new Map(layer.features) }
    ])
  )
}

export class Store {
  layers = new Map<string, UserLayer>()
  pending: Change[] = readStorage<Change[]>(PENDING_KEY, [])
  /** What undo took back, most recent last, until something new is done. */
  private redoable: Redo[] = []
  /**
   * Saved steps that can still be undone, most recent last. Undoing one doesn't
   * touch the server: it's a new change that puts things back, saved like any other.
   */
  private savedSteps: SavedStep[] = []
  // Batches of pending changes that undo a saved step, and that step (for Discard).
  private undoing = new Map<string, SavedStep>()
  // The layers as saved (before the pending changes), to rebuild them after an undo.
  private saved = new Map<string, UserLayer>()
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
      this.saved = new Map(
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
      this.layers = cloneLayers(this.saved)
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

  private record(op: ChangeOp, layer_id: string, feature_id?: string, data?: Change['data'], batch?: string) {
    const change: Change = { op, layer_id, feature_id, data, made_at: new Date().toISOString() }
    if (batch) change.batch = batch
    applyChange(this.layers, change)
    this.pending.push(change)
    this.redoable = []
    writeStorage(PENDING_KEY, this.pending)
    this.notify()
  }

  /** Rebuild the layers from what's saved and the pending changes. */
  private rebuild() {
    this.layers = cloneLayers(this.saved)
    for (const change of this.pending) applyChange(this.layers, change)
    if (this.activeLayer && !this.layers.has(this.activeLayer)) {
      this.activeLayer = this.layers.keys().next().value ?? null
    }
    writeStorage(PENDING_KEY, this.pending)
    this.notify()
  }

  /**
   * How many layers and items differ from what's saved: what Save would really
   * change. Changes that cancel out (lock then unlock) count for nothing.
   */
  get unsavedCount(): number {
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
    let count = 0
    const ids = new Set([...this.saved.keys(), ...this.layers.keys()])
    for (const id of ids) {
      const before = this.saved.get(id)
      const after = this.layers.get(id)
      if (!before || !after) {
        count += 1 + (before?.features.size ?? after?.features.size ?? 0)
        continue
      }
      if (before.name !== after.name || !same(before.style, after.style)) count++
      const features = new Set([...before.features.keys(), ...after.features.keys()])
      for (const f of features) {
        const a = before.features.get(f)
        const b = after.features.get(f)
        if (!a || !b || !same(a.geometry, b.geometry) || !same(a.properties, b.properties)) count++
      }
    }
    return count
  }

  /** The last pending change, unless it's one that undid a saved step. */
  private get lastOwn(): Change | undefined {
    const last = this.pending[this.pending.length - 1]
    return last && !(last.batch && this.undoing.has(last.batch)) ? last : undefined
  }

  get canUndo(): boolean {
    return !!this.lastOwn || this.savedSteps.length > 0
  }

  get canRedo(): boolean {
    return this.redoable.length > 0
  }

  /**
   * Take back the last change (all of it, if it was several at once). An unsaved
   * one is dropped; a saved one is put back by a new change, for the next Save.
   */
  undo() {
    const last = this.lastOwn
    if (last) {
      const taken: Change[] = []
      while (
        this.pending.length &&
        (!taken.length || (last.batch && this.pending[this.pending.length - 1].batch === last.batch))
      )
        taken.unshift(this.pending.pop()!)
      this.redoable.push({ changes: taken })
      this.rebuild()
      return
    }
    // Already back to how it was (someone else changed it since): the step before.
    while (this.savedSteps.length) {
      const step = this.savedSteps.pop()!
      const batch = uuid()
      const changes = restoring(this.layers, step, batch)
      if (!changes.length) continue
      this.undoing.set(batch, step)
      this.pending.push(...changes)
      this.redoable.push({ saved: step, batch })
      this.rebuild()
      return
    }
  }

  /** Do again what undo took back. */
  redo() {
    const last = this.redoable.pop()
    if (!last) return
    if ('changes' in last) {
      this.pending.push(...last.changes)
    } else {
      // Undid a saved step: drop the changes that did it (the last pending ones).
      this.pending = this.pending.filter((c) => c.batch !== last.batch)
      this.undoing.delete(last.batch)
      this.savedSteps.push(last.saved)
    }
    this.rebuild()
  }

  createLayer(name: string): string {
    const id = uuid()
    this.record('layer_create', id, undefined, { name, style: { color: DEFAULT_COLOR } })
    this.activeLayer = id
    this.notify()
    return id
  }

  updateLayer(id: string, changes: { name?: string; style?: UserLayer['style'] }) {
    const current = this.layers.get(id)
    if (
      current &&
      (changes.name === undefined || changes.name === current.name) &&
      (changes.style === undefined || JSON.stringify(changes.style) === JSON.stringify(current.style))
    )
      return
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
    // Nothing different (the same value picked or typed again): no change.
    const current = this.layers.get(layerId)?.features.get(feature.id)
    if (
      current &&
      JSON.stringify(current.geometry) === JSON.stringify(feature.geometry) &&
      JSON.stringify(current.properties) === JSON.stringify(feature.properties)
    )
      return
    this.record('feature_update', layerId, feature.id, {
      geometry: feature.geometry,
      properties: feature.properties
    })
  }

  deleteFeature(layerId: string, featureId: string) {
    this.record('feature_delete', layerId, featureId)
  }

  /** Change several features at once: one undo step. */
  updateFeatures(changes: { layerId: string; feature: UserFeature }[]) {
    const batch = uuid()
    for (const { layerId, feature } of changes) {
      this.record(
        'feature_update',
        layerId,
        feature.id,
        { geometry: feature.geometry, properties: feature.properties },
        batch
      )
    }
  }

  /** Delete several features at once: one undo step. */
  deleteFeatures(ids: string[]) {
    const batch = uuid()
    for (const id of ids) {
      const layer = this.layerOf(id)
      if (layer) this.record('feature_delete', layer.id, id, undefined, batch)
    }
  }

  /** Move several features to a layer at once: one undo step. */
  moveFeatures(ids: string[], toLayerId: string) {
    const batch = uuid()
    for (const id of ids) this.moveFeature(id, toLayerId, batch)
  }

  /** Move a feature to another layer (two changes: out of one, into the other). */
  moveFeature(featureId: string, toLayerId: string, batch = uuid()) {
    const from = this.layerOf(featureId)
    const feature = from?.features.get(featureId)
    if (!from || !feature || from.id === toLayerId || !this.layers.has(toLayerId)) return
    this.record('feature_delete', from.id, featureId, undefined, batch)
    this.record(
      'feature_create',
      toLayerId,
      featureId,
      { geometry: feature.geometry, properties: feature.properties },
      batch
    )
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
    // Everything cancelled out: nothing to send.
    if (!this.unsavedCount) {
      this.keepSteps()
      this.pending = []
      this.redoable = []
      writeStorage(PENDING_KEY, this.pending)
      this.notify()
      return
    }
    await saveChanges(this.pending, this.author)
    this.keepSteps()
    this.pending = []
    this.redoable = []
    writeStorage(PENDING_KEY, [])
    await this.load()
  }

  /**
   * The steps just saved, to undo after the save. Those that undid a saved step
   * are now done: that step stays undone.
   */
  private keepSteps() {
    const layers = cloneLayers(this.saved)
    for (const step of steps(this.pending)) {
      const undid = step[0].batch && this.undoing.has(step[0].batch)
      if (!undid) this.savedSteps.push(beforeOf(layers, step))
      for (const change of step) applyChange(layers, change)
    }
    this.undoing.clear()
    this.savedSteps.splice(0, this.savedSteps.length - MAX_SAVED_STEPS)
  }

  /** Forget the unsaved changes and go back to what's saved. */
  async discard() {
    // Saved steps undone without saving are still there to undo.
    this.savedSteps.push(...[...this.undoing.values()].reverse())
    this.undoing.clear()
    this.pending = []
    this.redoable = []
    writeStorage(PENDING_KEY, [])
    await this.load()
  }
}
