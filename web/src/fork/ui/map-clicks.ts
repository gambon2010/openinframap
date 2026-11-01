// Fork: a tool that takes the map's clicks for itself (measuring): meanwhile they
// don't open feature details or reach My layers' tools.
let owner: string | null = null

export const mapClicks = {
  take(name: string) {
    owner = name
  },
  release(name: string) {
    if (owner === name) owner = null
  },
  /** Who has them (null: nobody, clicks go where they usually do). */
  get taken(): string | null {
    return owner
  }
}
