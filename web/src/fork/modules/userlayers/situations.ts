// Fork: situations of My layers (docs/plans/my-layers-v3.md): named moments, viewed
// read-only by replaying the history up to the change they were saved after.
import { SavedChange } from './model.ts'
import { Situation } from './api.ts'

/** How many history steps a situation includes (its change and every earlier one). */
export function situationPosition(changes: SavedChange[], situation: Situation): number {
  return changes.filter((c) => c.id <= situation.change_id).length
}

/** "Morning brief · 30 Oct, 08:00" for menus. */
export function situationLabel(situation: Situation): string {
  const at = situation.at ?? situation.created_at
  const when = new Date(at).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
  return `${situation.name} · ${when}`
}
