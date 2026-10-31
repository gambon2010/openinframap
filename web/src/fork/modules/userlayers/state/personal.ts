// Fork: what's personal in My layers (docs/plans/sync.md, phase 5): each layer's
// folder, the layers hidden from the map, those open and the folders folded in the
// list, and folders made but still empty. Kept for the account on the server (GET /
// PUT /userdata/settings/userlayers), so it follows you to any computer, and in this
// browser (to show it at once, and when the server can't be reached). The first time,
// what this browser remembered (before accounts) is taken over.
const URL = '/userdata/settings/userlayers'
const KEY = 'oim-userlayers-personal'
// Kept in the browser before accounts.
const OLD = {
  hidden: 'oim-userlayers-hidden',
  folded: 'oim-userlayers-folded',
  empty: 'oim-userlayers-empty-folders'
}

export interface Personal {
  /** A layer's folder for you (null: in none); absent: the folder it had before
   * folders were personal (its style.folder), if any. */
  folders: Record<string, string | null>
  hidden: string[]
  /** Layers showing their items in the list. */
  expanded: string[]
  /** Folders folded to one line. */
  folded: string[]
  /** Folders made with "New folder" that no layer is in yet. */
  empty: string[]
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

function empty(): Personal {
  return { folders: {}, hidden: [], expanded: [], folded: [], empty: [] }
}

/** What this browser remembered before folders and the rest were personal. */
function fromThisBrowser(): Personal {
  return {
    ...empty(),
    hidden: readJson<string[]>(OLD.hidden, []),
    folded: readJson<string[]>(OLD.folded, []),
    empty: readJson<string[]>(OLD.empty, [])
  }
}

/** A stored value, with any key missing filled in. */
export function complete(value: Partial<Personal> | null | undefined): Personal {
  return { ...empty(), ...(value ?? {}) }
}

export class PersonalSettings {
  data: Personal = complete(readJson<Personal | null>(KEY, null) ?? fromThisBrowser())
  private timer: ReturnType<typeof setTimeout> | undefined
  private listeners: (() => void)[] = []

  onChange(listener: () => void) {
    this.listeners.push(listener)
  }

  /** Your settings from the server (the first time: this browser's, sent there). */
  async load() {
    try {
      const response = await fetch(URL)
      if (!response.ok) return
      const { value } = await response.json()
      if (value) this.data = complete(value)
      else this.save()
      this.keep()
      for (const listener of this.listeners) listener()
    } catch {
      // Offline: this browser's copy.
    }
  }

  private keep() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data))
    } catch {
      // Not remembered in this browser.
    }
  }

  /** Remember a change: in this browser at once, on the server a moment later. */
  save() {
    this.keep()
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void fetch(URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.data)
      }).catch(() => undefined)
    }, 500)
  }

  /** A layer's folder for you. */
  folderOf(layer: { id: string; style: { folder?: string } }): string | null {
    if (layer.id in this.data.folders) return this.data.folders[layer.id]
    return layer.style.folder?.trim() || null
  }

  setFolder(layerId: string, folder: string | null) {
    this.data.folders[layerId] = folder?.trim() || null
    if (folder) this.data.empty = this.data.empty.filter((f) => f !== folder)
    this.save()
  }

  /** Add or take out a value of one of the lists. */
  toggle(list: 'hidden' | 'expanded' | 'folded' | 'empty', value: string, on: boolean) {
    const set = new Set(this.data[list])
    if (on) set.add(value)
    else set.delete(value)
    this.data[list] = [...set]
    this.save()
  }
}
