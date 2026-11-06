// Fork: the symbol and graphic picker (palette.ts): its types.

/** [code with * for identity and status, name, depth, graphic geometry (L, A, M)] */
export type Entry = [code: string, name: string, depth: number, geometry?: 'L' | 'A' | 'M']

export type PaletteMode = 'symbols' | 'graphics'

/**
 * Categories in plain words, rather than the standard's sections: which catalogue
 * groups they take entries from, and which of those entries.
 */
export interface Category {
  mode: PaletteMode
  label: string
  groups: string[]
  test?: (entry: Entry) => boolean
}

export interface Pick {
  sidc: string
  name: string
  geometry?: 'L' | 'A' | 'M'
}
