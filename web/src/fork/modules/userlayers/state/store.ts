// Fork: "My layers" state. Every edit is a Change: applied here at once, kept as
// unsaved (in this browser too, local.ts) and sent with "Save", in order
// (transport.ts). The backend logs each one, which is the history that can be
// played back (history.ts). Undo and redo: undo.ts; the changes themselves:
// changes.ts.
import {
  Change,
  ChangeOp,
  FeatureProps,
  UserFeature,
  UserLayer,
  uuid,
  DEFAULT_COLOR
} from '../model/model.ts'
import { applyChange, cloneLayers, differences } from './changes.ts'
import { local } from './local.ts'
import { loadSaved, send } from './transport.ts'
import { UndoHistory } from './undo.ts'
import { View } from './view.ts'

export class Store {
  layers = new Map<string, UserLayer>()
  pending: Change[] = local.pending()
  private history = new UndoHistory()
  /** What the map shows (live or a past version) and what may be changed. */
  readonly view = new View()
  // The layers as saved (before the pending changes), to rebuild them after an undo.
  private saved = new Map<string, UserLayer>()
  hidden = new Set<string>(local.hidden())
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
    return local.author()
  }

  set author(name: string) {
    local.setAuthor(name)
  }

  /** The saved layers, with the unsaved changes on top. */
  async load() {
    try {
      this.saved = await loadSaved()
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
    this.history.done()
    local.setPending(this.pending)
    this.notify()
  }

  /** New pending changes (after an undo or redo): rebuild the layers from them. */
  private setPending(pending: Change[]) {
    this.pending = pending
    this.layers = cloneLayers(this.saved)
    for (const change of this.pending) applyChange(this.layers, change)
    if (this.activeLayer && !this.layers.has(this.activeLayer)) {
      this.activeLayer = this.layers.keys().next().value ?? null
    }
    local.setPending(this.pending)
    this.notify()
  }

  /**
   * How many layers and items differ from what's saved: what Save would really
   * change. Changes that cancel out (lock then unlock) count for nothing.
   */
  get unsavedCount(): number {
    return differences(this.saved, this.layers)
  }

  get canUndo(): boolean {
    return this.history.canUndo(this.pending)
  }

  get canRedo(): boolean {
    return this.history.canRedo
  }

  /**
   * Take back the last change (all of it, if it was several at once). An unsaved
   * one is dropped; a saved one is put back by a new change, for the next Save.
   */
  undo() {
    const pending = this.history.undo(this.pending, this.layers)
    if (pending) this.setPending(pending)
  }

  /** Do again what undo took back. */
  redo() {
    const pending = this.history.redo(this.pending)
    if (pending) this.setPending(pending)
  }

  createLayer(name: string, folder?: string): string {
    const id = uuid()
    const style: UserLayer['style'] = { color: DEFAULT_COLOR }
    if (folder) style.folder = folder
    this.record('layer_create', id, undefined, { name, style })
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
    local.setHidden([...this.hidden])
    this.notify()
  }

  setActive(layerId: string) {
    this.activeLayer = layerId
    this.notify()
  }

  /** Send the unsaved changes; they're logged on the server for the history. */
  async save() {
    if (!this.pending.length) return
    // Everything cancelled out: nothing to send (and nothing new to load).
    const changed = this.unsavedCount > 0
    if (changed) await send(this.pending, this.author)
    this.history.saved(this.pending, this.saved)
    this.pending = []
    local.setPending([])
    if (changed) await this.load()
    else this.notify()
  }

  /** Forget the unsaved changes and go back to what's saved. */
  async discard() {
    this.history.discarded()
    this.pending = []
    local.setPending([])
    await this.load()
  }
}
