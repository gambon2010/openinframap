import { readJson, writeJson } from '../../../core/storage.ts'
// Fork: what's personal in My layers (docs/plans/sync.md, phase 5): each layer's
// folder, the layers hidden from the map, those open and the folders folded in the
// list, folders made but still empty, the layer you draw into, your favourite and
// recently used symbols. Kept for the account on the server (GET / PUT
// /userdata/settings/userlayers), so it follows you to any computer, and in this
// browser (to show it at once, and when the server can't be reached). What the
// account doesn't have yet is taken from what this browser remembered before.
const URL = '/userdata/settings/userlayers'
const KEY = 'oim-userlayers-personal'
// Kept in the browser before accounts.
const OLD = {
  hidden: 'oim-userlayers-hidden',
  folded: 'oim-userlayers-folded',
  empty: 'oim-userlayers-empty-folders',
  favourites: 'oim-userlayers-favourites',
  recent: 'oim-userlayers-recent'
}
const MAX_RECENT = 12

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
  /** The layer new items go into ("Draw into this layer"). */
  active: string | null
  /** Catalogue codes (ui/palette.ts) starred, and the last picked (most recent first). */
  favourites: string[]
  recent: string[]
  /** The layers' order in the list, top first (also how they're drawn: the top one on
   * top). Layers not in it (new ones) come first, newest first. */
  order: string[]
  /** Measuring (measure/prefs.ts): bearings from which north; new rings' distances (m). */
  north?: 'true' | 'magnetic' | 'grid'
  radii?: number[]
}

// (This browser's storage: core/storage.ts.)

function empty(): Personal {
  return {
    folders: {},
    hidden: [],
    expanded: [],
    folded: [],
    empty: [],
    active: null,
    favourites: [],
    recent: [],
    order: []
  }
}

/** What this browser remembered before these were personal. */
function fromThisBrowser(): Personal {
  return {
    ...empty(),
    hidden: readJson<string[]>(OLD.hidden, []),
    folded: readJson<string[]>(OLD.folded, []),
    empty: readJson<string[]>(OLD.empty, []),
    favourites: readJson<string[]>(OLD.favourites, []),
    recent: readJson<string[]>(OLD.recent, [])
  }
}

/** A stored value, with any key missing filled in. */
export function complete(value: Partial<Personal> | null | undefined): Personal {
  return { ...empty(), ...(value ?? {}) }
}

/** A stored value, what it doesn't have yet taken from what this browser kept before. */
function withThisBrowser(value: Partial<Personal> | null | undefined): Personal {
  return { ...fromThisBrowser(), ...(value ?? {}) }
}

export class PersonalSettings {
  data: Personal = withThisBrowser(readJson<Partial<Personal> | null>(KEY, null))
  private timer: ReturnType<typeof setTimeout> | undefined
  private listeners: (() => void)[] = []

  onChange(listener: () => void) {
    this.listeners.push(listener)
  }

  /** Your settings from the server (the first time, or for what they don't have yet:
   * this browser's, sent there). */
  async load() {
    try {
      const response = await fetch(URL)
      if (!response.ok) return
      const { value } = (await response.json()) as { value: Partial<Personal> | null }
      this.data = withThisBrowser(value ?? this.data)
      if (!value || Object.keys(empty()).some((key) => !(key in value))) this.save()
      this.keep()
      for (const listener of this.listeners) listener()
    } catch {
      // Offline: this browser's copy.
    }
  }

  private keep() {
    writeJson(KEY, this.data)
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

  setOrder(ids: string[]) {
    this.data.order = ids
    this.save()
  }

  setActive(layerId: string | null) {
    if (this.data.active === layerId) return
    this.data.active = layerId
    this.save()
  }

  /** Star or unstar a symbol. */
  toggleFavourite(code: string) {
    this.toggle('favourites', code, !this.data.favourites.includes(code))
  }

  /** Remember a symbol picked, most recent first. */
  rememberRecent(code: string) {
    this.data.recent = [code, ...this.data.recent.filter((c) => c !== code)].slice(0, MAX_RECENT)
    this.save()
  }

  /** Add or take out a value of one of the lists. */
  toggle(list: 'hidden' | 'expanded' | 'folded' | 'empty' | 'favourites', value: string, on: boolean) {
    const set = new Set(this.data[list])
    if (on) set.add(value)
    else set.delete(value)
    this.data[list] = [...set]
    this.save()
  }
}
