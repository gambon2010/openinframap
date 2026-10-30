// Fork: My layers' undo and redo. Unsaved changes are taken back by dropping them;
// saved ones (up to MAX_SAVED_STEPS, in this tab) by new changes that put back only
// the fields that step changed (changes.ts restoring), so the server's log is never
// rewritten and what others changed since stays. The store owns the list of
// unsaved changes; these methods take it and give back the new one.
import { Change, UserLayer, uuid } from '../model.ts'
import { SavedStep, applyStep, cloneLayers, restoring, steps } from './changes.ts'

// How many saved steps undo can still take back.
const MAX_SAVED_STEPS = 200

type Redo = { changes: Change[] } | { saved: SavedStep; batch: string }

export class UndoHistory {
  /** What undo took back, most recent last, until something new is done. */
  private redoable: Redo[] = []
  /** Saved steps that can still be undone, most recent last. */
  private savedSteps: SavedStep[] = []
  // Batches of pending changes that undo a saved step, and that step (for Discard).
  private undoing = new Map<string, SavedStep>()

  /** The last pending change, unless it's one that undid a saved step. */
  private lastOwn(pending: Change[]): Change | undefined {
    const last = pending[pending.length - 1]
    return last && !(last.batch && this.undoing.has(last.batch)) ? last : undefined
  }

  canUndo(pending: Change[]): boolean {
    return !!this.lastOwn(pending) || this.savedSteps.length > 0
  }

  get canRedo(): boolean {
    return this.redoable.length > 0
  }

  /** Something new was done: nothing left to redo. */
  done() {
    this.redoable = []
  }

  /**
   * Take back the last change (all of it, if it was several at once): the pending
   * changes after it, or null if there's nothing to undo. An unsaved change is
   * dropped; a saved one is put back by new changes.
   */
  undo(pending: Change[], layers: Map<string, UserLayer>): Change[] | null {
    const last = this.lastOwn(pending)
    if (last) {
      const rest = [...pending]
      const taken: Change[] = []
      while (rest.length && (!taken.length || (last.batch && rest[rest.length - 1].batch === last.batch)))
        taken.unshift(rest.pop()!)
      this.redoable.push({ changes: taken })
      return rest
    }
    // Already back to how it was (someone else changed it since): the step before.
    while (this.savedSteps.length) {
      const step = this.savedSteps.pop()!
      const batch = uuid()
      const changes = restoring(layers, step, batch)
      if (!changes.length) continue
      this.undoing.set(batch, step)
      this.redoable.push({ saved: step, batch })
      return [...pending, ...changes]
    }
    return null
  }

  /** Do again what undo took back: the pending changes after it, or null. */
  redo(pending: Change[]): Change[] | null {
    const last = this.redoable.pop()
    if (!last) return null
    if ('changes' in last) return [...pending, ...last.changes]
    // Undid a saved step: drop the changes that did it (the last pending ones).
    this.undoing.delete(last.batch)
    this.savedSteps.push(last.saved)
    return pending.filter((c) => c.batch !== last.batch)
  }

  /**
   * The pending changes were saved (on top of `saved`): keep their steps, to undo
   * after the save. Those that undid a saved step are now done: it stays undone.
   */
  saved(pending: Change[], saved: Map<string, UserLayer>) {
    const layers = cloneLayers(saved)
    for (const step of steps(pending)) {
      const undid = step[0].batch && this.undoing.has(step[0].batch)
      const kept = applyStep(layers, step)
      if (!undid) this.savedSteps.push(kept)
    }
    this.undoing.clear()
    this.redoable = []
    this.savedSteps.splice(0, this.savedSteps.length - MAX_SAVED_STEPS)
  }

  /** The pending changes were thrown away: saved steps undone meanwhile can be undone again. */
  discarded() {
    this.savedSteps.push(...[...this.undoing.values()].reverse())
    this.undoing.clear()
    this.redoable = []
  }
}
