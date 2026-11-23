// Fork: import and export formats (formats.ts): its constants and tables.

// What says what an item is in My layers (kept on export, read back on import).
export const OWN = [
  'kind',
  'sidc',
  'modifiers',
  'axis',
  'axisWidth',
  'size',
  'color',
  'width',
  'image',
  'copy',
  'measure',
  'radii',
  'locked'
]

// ---------------------------------------------------------------------------------
// Export

export const NAME_KEYS = ['name', 'Name', 'NAME', 'title', 'Title', 'label']

export const NOTE_KEYS = ['description', 'desc', 'notes', 'Description', 'cmt']

// What KML and GPX readers add about the look: not worth keeping as notes.
export const STYLE_KEYS =
  /^(stroke|fill|marker|icon|label|styleUrl|styleHash|styleMapHash|visibility|_gpxType|times|coordinateProperties)/
