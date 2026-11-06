// Fork: plain labels on tactical graphics (labels.ts): its types.

export type LabelLanguage = 'en' | 'fr'

/**
 * A graphic's labels: for each text the renderer writes, what to write instead, in
 * English and French ('' = not written; a text not listed is kept), and its French
 * name (the English one is the catalogue's).
 */
export interface GraphicLabels {
  en?: Record<string, string>
  fr?: Record<string, string>
  /** Its name in French, for the legend. */
  name?: string
}

// Which labels graphics get, kept in this browser (like "Labels on the map"): ours in
// English or French, or the standard's (MIL-STD-2525) for trained users and maps
// shared with other systems.
export type GraphicLabelChoice = LabelLanguage | 'standard'
