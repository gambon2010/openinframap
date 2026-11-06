// Fork: "My layers" state. Every edit is a Change: applied here at once, kept as
// unsaved (in this browser too, local.ts) and sent with "Save", in order
// (transport.ts). The backend logs each one, which is the history that can be
// played back (history.ts). Undo and redo: undo.ts; the changes themselves:
// changes.ts.
import { Change, ChangeOp, FeatureProps, UserFeature, UserLayer, uuid } from '../model/model.ts'
import { applyChange, cloneLayers, differences } from './changes.ts'
import { local } from './local.ts'
import { loadSaved, send } from './transport.ts'
import { StaleError } from './api.ts'
import { Bases, Conflict, baseOf, changeKey, featureKey, reconcile } from './reconcile.ts'
import { FeatureState, LayerState } from './merge.ts'
import { PersonalSettings } from './personal.ts'
import { measurePrefs } from '../measure/prefs.ts'
import { UndoHistory } from './undo.ts'
import { View } from './view.ts'

export class Store {
  layers = new Map<string, UserLayer>()
  /** The unsaved changes (kept in this browser: local.ts; back when the page opens,
   * at the first load()). */
  pending: Change[] = []
  /** How what the pending changes touch was when they started (reconcile.ts). */
  private bases: Bases = {}
  private restored = false
  /** Items both you and someone else changed: Save waits until they're resolved. */
  conflicts: Conflict[] = []
  private history = new UndoHistory()
  /** What the map shows (live or a past version) and what may be changed. */
  readonly view = new View()
  // The layers as saved (before the pending changes), to rebuild them after an undo.
  private saved = new Map<string, UserLayer>()
  /** Your own folders, hidden layers... (personal.ts): not changes, never shared. */
  readonly personal = new PersonalSettings()
  hidden = new Set<string>(this.personal.data.hidden)
  /** The layer new items go into: yours (personal.ts), else the first there is. */
  get activeLayer(): string | null {
    const chosen = this.personal.data.active
    if (chosen && this.layers.has(chosen)) return chosen
    return this.layers.keys().next().value ?? null
  }

  set activeLayer(id: string | null) {
    this.personal.setActive(id)
  }
  loaded = false
  error: string | null = null
  private listeners: (() => void)[] = []
  // Many changes at once (an imported file): kept and shown once, at the end.
  private quiet = false

  constructor() {
    // Your settings from the server (another computer may have changed them).
    this.personal.onChange(() => {
      this.hidden = new Set(this.personal.data.hidden)
      this.usePrefs()
      this.notify()
    })
    this.usePrefs()
    // Measuring preferences changed (settings, a ring's card): kept for your account.
    measurePrefs.onChange(() => {
      const { north, radii } = measurePrefs
      if (
        this.personal.data.north === north &&
        JSON.stringify(this.personal.data.radii) === JSON.stringify(radii)
      )
        return
      this.personal.data.north = north
      this.personal.data.radii = radii
      this.personal.save()
    })
    // The unsaved changes can't be kept in this browser (or can again): the page says so.
    local.onTrouble(() => this.notify())
  }

  /** Your measuring preferences, from your settings. */
  private usePrefs() {
    const { north, radii } = this.personal.data
    measurePrefs.set({ ...(north ? { north } : {}), ...(radii?.length ? { radii } : {}) })
  }

  /** Why the unsaved changes can't be kept in this browser (null: they are). */
  get keepTrouble(): string | null {
    return local.trouble
  }

  /** The unsaved changes this browser kept (a reload, a crash), before any made since. */
  private async restore() {
    if (this.restored) return
    this.restored = true
    const kept = await local.load()
    if (kept.pending.length) {
      this.pending = [...kept.pending, ...this.pending]
      // A base kept is older than one noted since for the same thing: it wins.
      this.bases = { ...this.bases, ...kept.bases }
    }
    // Written now (nothing was before: it would have overwritten what was kept).
    local.setBases(this.bases)
    local.setPending(this.pending)
  }

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

  /** The saved layers, with the unsaved changes on top (merged with what others
   * saved meanwhile, if there are any: reconcile.ts). */
  async load() {
    await this.restore()
    try {
      const fresh = await loadSaved()
      if (this.pending.length && Object.keys(this.bases).length) this.bringUpToDate(fresh)
      else {
        this.saved = fresh
        this.layers = cloneLayers(this.saved)
        for (const change of this.pending) applyChange(this.layers, change)
      }
      this.error = null
    } catch (e) {
      this.error = String((e as Error).message ?? e)
    }
    this.loaded = true
    this.notify()
  }

  /**
   * Your changes as they'd be on the layers they started from (the bases put back
   * into the server's layers): what reconcile calls yours.
   */
  private yours(fresh: Map<string, UserLayer>): Map<string, UserLayer> {
    const layers = cloneLayers(fresh)
    const shell = (id: string) => {
      if (!layers.has(id)) layers.set(id, { id, name: '', style: {}, features: new Map() })
      return layers.get(id)!
    }
    for (const [key, base] of Object.entries(this.bases)) {
      const id = key.slice(key.indexOf(':') + 1)
      if (key.startsWith('layer:')) {
        const state = base.state as LayerState | null
        if (!state) layers.delete(id)
        else Object.assign(shell(id), { name: state.name, style: { ...state.style } })
      } else {
        for (const layer of layers.values()) layer.features.delete(id)
        const state = base.state as FeatureState | null
        if (state) shell(state.layerId).features.set(id, state.feature)
      }
    }
    for (const change of this.pending) applyChange(layers, change)
    return layers
  }

  /**
   * Someone saved something you can see (a live update, ui/live.ts): fetch the
   * layers again. With no unsaved changes, they're simply shown; with some, they're
   * merged with yours (conflicts not yet resolved stay).
   */
  async refresh() {
    if (this.saving) {
      this.refreshAfterSave = true
      return
    }
    let fresh: Map<string, UserLayer>
    try {
      fresh = await loadSaved()
    } catch {
      return // offline for a moment: the next update tries again
    }
    if (this.saving) {
      this.refreshAfterSave = true
      return
    }
    if (this.pending.length && Object.keys(this.bases).length) this.bringUpToDate(fresh)
    else {
      this.saved = fresh
      this.layers = cloneLayers(fresh)
      for (const change of this.pending) applyChange(this.layers, change)
      this.notify()
    }
  }

  // A Save is under way: a live update waits for it (and comes after).
  private saving = false
  private refreshAfterSave = false

  /** Bring the pending changes onto the server's layers, merged; conflicts noted. */
  private bringUpToDate(fresh: Map<string, UserLayer>) {
    const out = reconcile(this.bases, this.pending, this.yours(fresh), fresh)
    this.saved = fresh
    this.bases = out.bases
    // Conflicts not resolved yet stay, while you still have changes to them (their
    // base is now the server's, so merging again wouldn't find them).
    const still = this.conflicts.filter(
      (old) =>
        !out.conflicts.some((c) => c.key === old.key) && out.pending.some((c) => changeKey(c) === old.key)
    )
    this.conflicts = [...still, ...out.conflicts]
    this.history.reset()
    local.setBases(this.bases)
    this.setPending(out.pending)
  }

  /** Whether an item or layer is in conflict (shown as such on the map and in the list). */
  inConflict(key: string): boolean {
    return this.conflicts.some((c) => c.key === key)
  }

  isFeatureInConflict(featureId: string): boolean {
    return this.inConflict(featureKey(featureId))
  }

  /** Settle a conflict: keep your version (saved with the next Save), or take theirs. */
  resolve(key: string, keep: 'mine' | 'theirs') {
    this.conflicts = this.conflicts.filter((c) => c.key !== key)
    if (keep === 'theirs') this.setPending(this.pending.filter((c) => changeKey(c) !== key))
    else this.notify()
  }

  resolveAll(keep: 'mine' | 'theirs') {
    for (const { key } of [...this.conflicts]) this.resolve(key, keep)
  }

  private record(op: ChangeOp, layer_id: string, feature_id?: string, data?: Change['data'], batch?: string) {
    const change: Change = { op, layer_id, feature_id, data, made_at: new Date().toISOString() }
    if (batch) change.batch = batch
    // The first change to something: note how it's saved (and its version).
    const key = changeKey(change)
    if (!(key in this.bases)) {
      this.bases[key] = baseOf(this.saved, key)
      local.setBases(this.bases)
    }
    applyChange(this.layers, change)
    this.pending.push(change)
    this.history.done()
    if (this.quiet) return
    local.setPending(this.pending)
    this.notify()
  }

  /** New pending changes (after an undo or redo): rebuild the layers from them. */
  private setPending(pending: Change[]) {
    this.pending = pending
    this.layers = cloneLayers(this.saved)
    for (const change of this.pending) applyChange(this.layers, change)
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
    if (folder) this.personal.setFolder(id, folder)
    this.record('layer_create', id, undefined, { name, style: {} })
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
    this.notify()
  }

  /** A new layer with items (an imported file): one change, undone at once. */
  importLayer(name: string, items: { geometry: GeoJSON.Geometry; properties: FeatureProps }[]): string {
    const id = uuid()
    const batch = uuid()
    this.quiet = true
    try {
      this.record('layer_create', id, undefined, { name, style: {} }, batch)
      for (const item of items) this.record('feature_create', id, uuid(), item, batch)
    } finally {
      this.quiet = false
    }
    local.setPending(this.pending)
    this.activeLayer = id
    this.notify()
    return id
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
    this.personal.toggle('hidden', layerId, hidden)
    this.notify()
  }

  setActive(layerId: string) {
    this.activeLayer = layerId
    this.notify()
  }

  /** Whether Save can go: something to save, and no conflict left. */
  get canSave(): boolean {
    return this.pending.length > 0 && this.conflicts.length === 0
  }

  /**
   * Send the unsaved changes; they're logged on the server for the history. If
   * someone else saved some of the same items meanwhile, nothing is saved: they're
   * fetched and merged with yours (StaleError, for a message), to save again.
   */
  async save() {
    if (!this.pending.length) return
    if (this.conflicts.length) throw new Error('Resolve the conflicts first')
    // Everything cancelled out: nothing to send (and nothing new to load).
    const changed = this.unsavedCount > 0
    this.saving = true
    try {
      if (changed) {
        try {
          await send(this.pending, this.bases, this.author)
        } catch (e) {
          if (e instanceof StaleError) this.bringUpToDate(await loadSaved())
          throw e
        }
      }
      this.history.saved(this.pending, this.saved)
      this.pending = []
      this.bases = {}
      local.setPending([])
      local.setBases({})
      if (changed) await this.load()
      else this.notify()
    } finally {
      this.saving = false
      if (this.refreshAfterSave) {
        this.refreshAfterSave = false
        void this.refresh()
      }
    }
  }

  /** Forget the unsaved changes and go back to what's saved. */
  async discard() {
    this.history.discarded()
    this.pending = []
    this.bases = {}
    this.conflicts = []
    local.setPending([])
    local.setBases({})
    await this.load()
  }
}
