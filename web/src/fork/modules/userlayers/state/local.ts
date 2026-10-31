// Fork: what My layers keeps in this browser (localStorage): the unsaved changes
// (so a reload or crash doesn't lose them) and what they started from, the author's
// name (the hidden layers and folders are personal.ts).
// Storage can be blocked (private window): then it lasts until the page closes.
import { Change } from '../model/model.ts'
import type { Bases } from './reconcile.ts'
import { author, setAuthor } from '../../../core/author.ts'

const PENDING_KEY = 'oim-userlayers-pending'
const BASES_KEY = 'oim-userlayers-bases'

function read<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private window or storage blocked: kept until the page is closed.
  }
}

export const local = {
  pending: (): Change[] => read<Change[]>(PENDING_KEY, []),
  setPending: (changes: Change[]) => write(PENDING_KEY, changes),
  // How what the unsaved changes touch was when they started (reconcile.ts).
  bases: (): Bases => read<Bases>(BASES_KEY, {}),
  setBases: (bases: Bases) => write(BASES_KEY, bases),
  // Shared with the statuses (core/author.ts).
  author,
  setAuthor
}
