// Fork: what the map shows of My layers, and what may be changed now.
//   live        the layers as they are; editable, except locked layers
//   situation   a saved situation (a past version), read-only
//   playback    a step of the history, read-only
// Every "can I change this?" asks canEdit, so view-only access to a shared layer
// (docs/plans/sync.md) will be one more rule there.
import { UserLayer } from '../model/model.ts'
import { Situation } from './api.ts'

export type ViewMode = 'live' | 'situation' | 'playback'

export class View {
  mode: ViewMode = 'live'
  /** The situation shown, in situation mode. */
  situation: Situation | null = null
  /** A situation's layers, shown (read-only) in the list instead of the live ones. */
  past: Map<string, UserLayer> | null = null

  get live(): boolean {
    return this.mode === 'live'
  }

  /** Whether a layer's items (and the layer) may be changed now. */
  canEdit(layer: UserLayer | null | undefined): boolean {
    return this.live && !!layer && !layer.style.locked
  }

  showSituation(situation: Situation, layers: Map<string, UserLayer>) {
    this.mode = 'situation'
    this.situation = situation
    this.past = layers
  }

  showPlayback() {
    this.mode = 'playback'
    this.situation = null
    this.past = null
  }

  goLive() {
    this.mode = 'live'
    this.situation = null
    this.past = null
  }
}
