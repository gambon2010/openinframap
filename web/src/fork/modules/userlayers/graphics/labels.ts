import { readText, writeText } from '../../../core/storage.ts'
// Fork: plain labels on tactical graphics (docs/plans/graphic-labels.md). The renderer
// writes the standard's text on 110 graphics ("B", "C ENY", "CATK"...), and several
// share a letter (B is Block, Breach, Bypass, Bridgehead, Bearing line). For readers
// with little or no training, each graphic gets a label of its own, in English and in
// French (the French Army's terms, TTA 106, where it has them): one letter only for
// the most common, short words in full, others shortened (CATK) or as initials (WUP).
// Which labels (English, French, or the standard's) is chosen in My layers' settings,
// not taken from the browser's language, so everyone on a map can see the same.
import type { LabelLanguage, GraphicLabelChoice } from './labels.types.ts'
import { GRAPHIC_LABELS, KEY } from './labels.constants.ts'

/** The 2525C code without affiliation and status, as GRAPHIC_LABELS and SQUARE key it. */
export function graphicKey(sidc: string): string {
  const code = sidc.slice(0, 10).replace(/-+$/, '')
  return code.slice(0, 1) + '*' + code.slice(2, 3) + '*' + code.slice(4)
}

let choice: GraphicLabelChoice = (() => {
  const kept = readText(KEY)
  return kept === 'fr' || kept === 'standard' ? kept : 'en'
})()

export function graphicLabelChoice(): GraphicLabelChoice {
  return choice
}

export function setGraphicLabelChoice(value: GraphicLabelChoice) {
  choice = value
  writeText(KEY, value)
}

/** The language of our labels now (null: the standard's). */
export function labelLanguage(): LabelLanguage | null {
  return choice === 'standard' ? null : choice
}

/** What to write instead of a text the renderer writes on a graphic ('' = nothing;
 * the standard's labels: the text as it is). */
export function plainLabel(sidc: string, text: string, language = labelLanguage()): string {
  if (!language) return text
  const replace = GRAPHIC_LABELS[graphicKey(sidc)]?.[language]
  const key = text.trim()
  return replace && key in replace ? replace[key] : text
}

/** A graphic's name in the chosen language (French: GRAPHIC_LABELS; else `english`). */
export function graphicName(sidc: string, english: string, language = labelLanguage()): string {
  return (language === 'fr' && GRAPHIC_LABELS[graphicKey(sidc)]?.name) || english
}
