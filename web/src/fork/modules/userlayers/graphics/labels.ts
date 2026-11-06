import { readText, writeText } from '../../../core/storage.ts'
// Fork: plain labels on tactical graphics (docs/plans/graphic-labels.md). The renderer
// writes the standard's text on 110 graphics ("B", "C ENY", "CATK"...), and several
// share a letter (B is Block, Breach, Bypass, Bridgehead, Bearing line). For readers
// with little or no training, each graphic gets a label of its own, in English and in
// French (the French Army's terms, TTA 106, where it has them): one letter only for
// the most common, short words in full, others shortened (CATK) or as initials (WUP).
// Which labels (English, French, or the standard's) is chosen in My layers' settings,
// not taken from the browser's language, so everyone on a map can see the same.

export type LabelLanguage = 'en' | 'fr'

/**
 * A graphic's labels: for each text the renderer writes, what to write instead, in
 * English and French ('' = not written; a text not listed is kept), and its French
 * name (the English one is the catalogue's).
 */
interface GraphicLabels {
  en?: Record<string, string>
  fr?: Record<string, string>
  /** Its name in French, for the legend. */
  name?: string
}

// Keys: the 2525C code, affiliation and status left out (graphicKey).
export const GRAPHIC_LABELS: Record<string, GraphicLabels> = {
  // Tactical tasks.
  'G*T*B': { name: 'Barrer' },
  'G*T*H': { en: { B: 'BREACH' }, fr: { B: 'BRCH' }, name: 'Bréchage' },
  'G*T*Y': { en: { B: 'BYPASS' }, fr: { B: 'CTRN' }, name: 'Contourner' },
  'G*T*C': { en: { C: 'CNLZ' }, fr: { C: 'CNLS' }, name: 'Canaliser' },
  'G*T*X': { fr: { C: 'NETT' }, name: 'Nettoyer' },
  'G*T*J': { en: { C: 'CNTN', ENY: '' }, fr: { C: 'CNTN', ENY: '' }, name: 'Contenir' },
  'G*T*K': { name: 'Contre-attaquer' },
  'G*T*KF': { en: { CATK: 'CATK F' }, fr: { CATK: 'CATK F' }, name: 'Contre-attaque par le feu' },
  'G*T*UC': { en: { C: 'COVER' }, fr: { C: 'COUV' }, name: 'Couvrir' },
  'G*T*L': { en: { D: 'DELAY' }, fr: { D: 'RETAR' }, name: 'Retarder' },
  'G*T*T': { name: 'Désorganiser' },
  'G*T*F': { name: 'Fixer' },
  'G*T*UG': { name: 'Flanc-garder' },
  'G*T*E': { name: 'Isoler' },
  'G*T*O': { name: 'Occuper' },
  'G*T*P': { fr: { P: 'PERCER' }, name: 'Percer' },
  'G*T*Q': { fr: { R: 'TEN' }, name: 'Tenir' },
  'G*T*M': { en: { R: 'RETIRE' }, fr: { R: 'RETRO' }, name: 'Mouvement rétrograde' },
  'G*T*US': { en: { S: 'SCREEN' }, fr: { S: 'SURV' }, name: 'Surveiller' },
  'G*T*S': { en: { S: 'SECURE' }, fr: { S: 'CTR-Z' }, name: 'Contrôler une zone' },
  'G*T*Z': { fr: { S: 'SAISIR' }, name: 'Saisir' },
  'G*T*W': { name: 'Se replier' },
  'G*T*WP': { en: { WP: 'WUP' }, fr: { WP: 'RSP' }, name: 'Repli sous la pression' },
  'G*T*R': { fr: { RIP: 'RELÈVE' }, name: 'Relève sur position' },
  // Lines.
  'G*O*B': { en: { B: 'BRG' }, fr: { B: 'AZIMUT' }, name: 'Ligne de relèvement' },
  'G*G*SLB': { en: { B: 'BRHD' }, fr: { B: 'TDP' }, name: 'Tête de pont' },
  'G*G*GLP': { fr: { PL: 'L BO' }, name: 'Ligne de bond' },
  'G*G*OLT': { name: 'Ligne de débouché' },
  'G*G*GLC': { fr: { LC: 'L CTC' }, name: 'Ligne de contact' },
  'G*G*OLC': { en: { 'LD/LC': 'LD/C' }, fr: { 'LD/LC': 'LD/C' }, name: 'Ligne de débouché / contact' },
  'G*G*OLL': { name: "Limite d'avance" },
  'G*G*OLF': { name: 'Ligne de coordination finale' },
  'G*G*OLP': { fr: { PLD: 'LPDO' }, name: 'Ligne de prise de déploiement opérationnel' },
  'G*G*SLH': { fr: { HL: 'LRCL' }, name: 'Ligne de recueil' },
  'G*G*SLR': { fr: { RL: 'LIA' }, name: "Ligne d'identification et d'accueil" },
  'G*G*GLL': { fr: { LL: 'BLK' }, name: 'Ligne de feux masqués (black-out)' },
  'G*G*GLF': { name: 'Ligne avant des forces amies' },
  'G*G*DLF': { name: 'Limite avant de la zone de bataille' },
  'G*G*SAA': {
    en: { 'AIRHEAD LINE': 'AIRHEAD' },
    fr: { 'AIRHEAD LINE': 'TPA' },
    name: 'Tête de pont aéroportée'
  },
  // Areas and positions.
  'G*G*GAA': { fr: { AA: 'ZRA' }, name: "Zone de regroupement et d'attente" },
  'G*G*OAA': { fr: { ASLT: 'ASSAUT' }, name: "Position d'assaut" },
  'G*G*OAK': { name: "Position d'attaque" },
  'G*G*OAO': { name: 'Objectif' },
  'G*G*GAE': { fr: { EA: 'ZE' }, name: "Zone d'engagement" },
  'G*G*SAO': { fr: { AO: 'ZA' }, name: "Zone d'action" },
  'G*G*SAN': { fr: { NAI: 'ZIR' }, name: "Zone d'intérêt du renseignement" },
  'G*G*SAT': { fr: { TAI: 'ZIO' }, name: "Zone d'intérêt des objectifs" },
  'G*G*GAY': { fr: { LAA: 'ZRES' }, name: "Zone d'accès restreint" },
  'G*G*GAD': { name: 'Zone de saut' },
  'G*G*GAL': { name: "Zone d'atterrissage" },
  'G*G*GAP': { fr: { PZ: 'Z-EMB' }, name: "Zone d'embarquement" },
  'G*G*GAX': { fr: { EZ: 'Z-EXF' }, name: "Zone d'exfiltration" },
  'G*G*DABP': { name: 'Préparée, non occupée' },
  // Obstacles and mines.
  'G*M*OFA': { name: 'Zone minée' },
  'G*G*PM': { en: { M: 'DECOY M' }, fr: { M: 'M FACT' }, name: 'Zone minée factice' },
  'G*G*PY': { en: { M: 'DECOY M' }, fr: { M: 'M FACT' }, name: 'Zone minée factice, clôturée' },
  'G*M*OGF': { fr: { FREE: 'ZLO' }, name: "Zone à laisser libre d'obstacles" },
  'G*M*OU': { name: 'Zone de munitions non explosées' },
  'G*M*OT': { name: 'Fil tendu' },
  'G*F*ATS': { fr: { SMOKE: 'FUMI' }, name: 'Fumigène' },
  'G*F*LTS': { fr: { SMOKE: 'FUMI' }, name: 'Fumigène (linéaire)' },
  // Support and movement.
  'G*S*LRM': { name: 'Itinéraire principal de ravitaillement' },
  'G*S*LRO': { name: 'Itinéraire principal de ravitaillement, sens unique' },
  'G*S*LRW': { name: 'Itinéraire principal de ravitaillement, double sens' },
  'G*S*LRA': { name: 'Itinéraire de ravitaillement de secours' },
  'G*S*LRT': { name: 'Circulation alternée' },
  'G*S*AR': { name: 'Point de ravitaillement et de réarmement avancé' },
  'G*S*ASB': { fr: { BSA: 'ZS BRIG' }, name: 'Zone de soutien de brigade' },
  'G*S*ASD': { fr: { DSA: 'ZS DIV' }, name: 'Zone de soutien de division' },
  'G*S*ASR': { fr: { RSA: 'ZS RGT' }, name: 'Zone de soutien de régiment' },
  'G*S*AD': {
    en: { DETAINEE: 'DET', HOLDING: '', AREA: '' },
    fr: { DETAINEE: 'Z-DÉT', HOLDING: '', AREA: '' },
    name: 'Zone de détenus'
  },
  'G*S*AE': {
    en: { EPW: 'POW', HOLDING: '', AREA: '' },
    fr: { EPW: 'Z-PG', HOLDING: '', AREA: '' },
    name: 'Zone de prisonniers de guerre'
  },
  'G*S*AH': {
    en: { REFUGEE: 'REF', HOLDING: '', AREA: '' },
    fr: { REFUGEE: 'Z-RÉF', HOLDING: '', AREA: '' },
    name: 'Zone de réfugiés'
  },
  // Fire support kept as acronyms, but these three mean something else in French
  // doctrine (TTA 106: DA défense aérienne, ZOR zone d'opérations rapprochées, TBA
  // très basse altitude).
  'G*F*ACDI': { fr: { DA: 'Z-MORT' }, name: "Zone d'angle mort" },
  'G*F*ACZI': { fr: { ZOR: 'ZR' }, name: 'Zone de responsabilité' },
  'G*F*ACBI': { fr: { TBA: 'Z-CIB' }, name: 'Zone de concentration des cibles' },
  'G*O*BE': { name: 'Électronique' },
  'G*O*BA': { name: 'Acoustique' },
  'G*O*BT': { name: 'Torpille' },
  'G*O*BO': { en: { O: 'EO' }, fr: { O: 'IEO' }, name: 'Interception électro-optique' }
}

/** The 2525C code without affiliation and status, as GRAPHIC_LABELS and SQUARE key it. */
export function graphicKey(sidc: string): string {
  const code = sidc.slice(0, 10).replace(/-+$/, '')
  return code.slice(0, 1) + '*' + code.slice(2, 3) + '*' + code.slice(4)
}

// Which labels graphics get, kept in this browser (like "Labels on the map"): ours in
// English or French, or the standard's (MIL-STD-2525) for trained users and maps
// shared with other systems.
export type GraphicLabelChoice = LabelLanguage | 'standard'
const KEY = 'oim-userlayers-graphic-labels'

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

/** A graphic's own label (its texts, replaced), for the legend; null if it has none. */
export function labelOf(sidc: string, texts: string[], language = labelLanguage()): string | null {
  const written = [...new Set(texts.map((text) => plainLabel(sidc, text, language).trim()).filter(Boolean))]
  return written.length ? written.join(' ') : null
}

/** A graphic's name in the chosen language (French: GRAPHIC_LABELS; else `english`). */
export function graphicName(sidc: string, english: string, language = labelLanguage()): string {
  return (language === 'fr' && GRAPHIC_LABELS[graphicKey(sidc)]?.name) || english
}
