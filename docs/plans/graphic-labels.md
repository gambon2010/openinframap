# Plan: plain labels on tactical graphics

Status: **proposal, for review** (2026-11-05). Nothing built yet.

## Goal

Make graphics readable by someone with little or no military training. The
renderer writes the standard's text on 110 of the 212 graphics in the catalogue
("B", "C", "CATK", "WP"…). Several graphics share a letter: B is Block, Breach,
Bypass, Bridgehead and Bearing line. That text is plain text in the renderer's
output (`renderGraphic`, `map/graphics.ts`), so it can be replaced per graphic.

## Rules

1. **A single letter only for the most common graphic** among those that share it
   (Block keeps B; Breach, Bypass… don't).
2. **Short words are written in full**: up to 6 letters (GUARD, BREACH, SECURE).
3. **Longer single words are shortened**, keeping consonants a reader recognises:
   CATK, CNLZ, WDRW.
4. **Several words become their initials**: WUP (withdraw under pressure).
5. **Each label means one thing** in its language. The legend and the item's card
   give the full name next to it: "WUP: Withdraw under pressure".
6. **French follows the same rules from the French words**: RSP (retraite sous
   pression). The French terms below are my proposals: the French Army's official
   terms (APP-6 in French, *mémentos* of tactical tasks) may differ; to check.
7. **Technical acronyms stay as they are** (fire support, airspace: FSCL, ROZ, FFA…).
   Whoever uses those knows them; the legend spells them out.

## Tactical tasks (the most used)

| Graphic | Standard | English | French name | French |
|---|---|---|---|---|
| Block | B | **B** | Bloquer | **B** |
| Breach | B | BREACH | Ouvrir une brèche | BRÈCHE |
| Bypass | B | BYPASS | Contourner | CTRN |
| Canalize | C | CNLZ | Canaliser | CNLS |
| Clear | C | **C** | Nettoyer | NETTOY |
| Contain | C ENY | CNTN ENEMY | Contenir | CNTN ENNEMI |
| Counterattack | CATK | CATK | Contre-attaque | CATQ |
| Counterattack by fire | CATK | CATK FIRE | Contre-attaque par le feu | CAF |
| Cover | C | COVER | Couvrir | CVR |
| Delay | D | DELAY | Freiner | FREINER |
| Disrupt | D | **D** | Désorganiser | D |
| Fix | F | **F** | Fixer | **F** |
| Guard | G | GUARD | Flanc-garder | FG |
| Isolate | I | ISOL | Isoler | ISOLER |
| Occupy | O | OCCUPY | Occuper | OCCUPER |
| Penetrate | P | PNTR | Percer | PERCER |
| Retain | R | **R** | Tenir | TENIR |
| Retirement | R | RTMT | Repli | REPLI |
| Screen | S | SCREEN | Surveiller | SURV |
| Secure | S | SECURE | Sécuriser | SÉCUR |
| Seize | S | **S** | S'emparer de | S |
| Withdraw | W | WDRW | Se retirer | RETRAIT |
| Withdraw under pressure | WP | WUP | Retraite sous pression | RSP |
| Relief in place | RIP | RIP | Relève sur place | RSP → **RELÈVE** |

Two French clashes, resolved:
- **RSP** would be both "retraite sous pression" and "relève sur place". The relief
  gets RELÈVE (6 letters, in full).
- **B** goes to Bloquer only. Contourner (bypass) is CTRN.

## Lines

| Graphic | Standard | English | French name | French |
|---|---|---|---|---|
| Bearing line | B | BL | Ligne de relèvement | LR |
| Bridgehead | B | BRHD | Tête de pont | TDP |
| Phase line | PL | PL | Ligne de phase / ligne de coordination | LC? |
| Line of departure | LD | LD | Ligne de débouché | LD |
| Line of contact | LC | LC | Ligne de contact | LCT |
| Line of departure / line of contact | LD/LC | LD/LC | Débouché / contact | LD/LCT |
| Limit of advance | LOA | LOA | Limite d'avance | LA |
| Final coordination line | FCL | FCL | Ligne de coordination finale | LCF |
| Probable line of deployment | PLD | PLD | Ligne probable de déploiement | LPD |
| Holding line | HL | HL | Ligne de recueil | LR → **LREC** |
| Release line | RL | RL | Ligne de libération | LL → **LLIB** |
| Light line | LL | LL | Ligne de feux masqués | LFM |
| Forward line of own troops | FLOT | FLOT | Ligne avant des troupes amies | LATA |
| Forward edge of battle area | FEBA | FEBA | Limite avant de la zone de bataille | LAZB |
| Airhead line | AIRHEAD LINE | AIRHEAD | Tête aéroportée | TAP |

French clashes resolved: LR (bearing line) vs ligne de recueil → **LREC**; LL is
kept for nothing (light line is LFM), ligne de libération → **LLIB**. "Phase line"
in French is to check: the French Army often says *ligne de coordination*. If so,
"LC" would clash with line of contact (LCT here).

## Areas and positions

| Graphic | Standard | English | French name | French |
|---|---|---|---|---|
| Assembly area | AA | AA | Zone de regroupement | ZR |
| Assault position | ASLT | ASLT | Position d'assaut | PASLT |
| Attack position | ATK | ATK | Position d'attaque | PATQ |
| Objective | OBJ | OBJ | Objectif | OBJ |
| Engagement area | EA | EA | Zone d'engagement | ZE |
| Area of operations | AO | AO | Zone d'opérations | ZO |
| Named area of interest | NAI | NAI | Zone d'intérêt nommée | ZIN |
| Targeted area of interest | TAI | TAI | Zone d'intérêt ciblée | ZIC |
| Limited access area | LAA | LAA | Zone d'accès restreint | ZAR |
| Drop zone | DZ | DZ | Zone de mise à terre | ZMT |
| Landing zone | LZ | LZ | Zone de poser | ZP |
| Pickup zone | PZ | PZ | Zone d'embarquement | ZE → **ZEMB** |
| Extraction zone | EZ | EZ | Zone d'extraction | ZX |
| Prepared but not occupied | (P) | (P) | Préparée, non occupée | (P) |
| Airhead | AIRHEAD LINE | AIRHEAD | Tête aéroportée | TAP |

French clash: ZE (engagement) vs zone d'embarquement → **ZEMB**.

## Obstacles and mines

| Graphic | Standard | English | French name | French |
|---|---|---|---|---|
| Mined area | M | **M** | Zone minée | **M** |
| Decoy mined area (and fenced) | M | DECOY M | Zone minée factice | M FACT |
| Obstacle free area | FREE | FREE | Zone libre d'obstacles | LIBRE |
| Unexploded ordnance area | UXO | UXO | Munitions non explosées | UXO |
| Trip wire | t | TRIP | Fil piège | PIÈGE |
| Smoke / linear smoke target | SMOKE | SMOKE | Fumigène | FUMI |

## Support and movement

| Graphic | Standard | English | French name | French |
|---|---|---|---|---|
| Main supply route | MSR | MSR | Itinéraire principal de ravitaillement | IPR |
| One-way / two-way traffic (on an MSR) | MSR | MSR | Idem | IPR |
| Alternate supply route | ASR | ASR | Itinéraire de ravitaillement de secours | IRS |
| Alternating traffic | ALT ASR | ALT ASR | Circulation alternée | IRS ALT |
| Forward arming and refuelling point | FARP | FARP | Point de ravitaillement avancé | FARP |
| Brigade / division / regimental support area | BSA, DSA, RSA | BSA, DSA, RSA | Zone de soutien (brigade…) | ZSB, ZSD, ZSR |
| Detainee / EPW / refugee holding area | AREA … HOLDING | DETAINEES, POW, REFUGEES | Détenus, prisonniers, réfugiés | DÉTENUS, PRISON, RÉFUGIÉS |
| Electro-optical intercept | O | EO | Interception électro-optique | EO |
| Electronic / acoustic / torpedo (decoys, sensors) | E, A, T | ELEC, ACOU, TORP | Électronique, acoustique, torpille | ÉLEC, ACOU, TORP |

## Kept as they are (technical acronyms)

Fire support and airspace, used by people who know them; the legend gives the full
name (and in French the French name):
FPF, FSCL, CFL, NFL, RFL, MFP, BOMB, FSA, FFA, NFA, RFA, ACA, DA, ZOR, TBA, TVAR,
TGMF, ATI ZONE, CFF ZONE, CENSOR ZONE, CF ZONE, SENSOR ZONE, BKB, PKB, ROZ,
SHORADEZ, HIDACZ, MEZ, LOMEZ, HIMEZ, WFZ. Their field texts ("MAX ALT:",
"TIME FROM:") are filled from the card's fields, unchanged.

## How it would work (once agreed)

- One table `GRAPHIC_LABELS` (2525C code → label and full name), with French in
  `fr.json` like the rest. `renderGraphic` replaces the standard's text with it
  on the map, in the preview, on prints and in the legend.
- The legend writes "WUP: Withdraw under pressure"; the card says the same.
- A setting **"Standard letters (MIL-STD-2525)"** for trained users and for maps
  shared with other systems (ATAK, ODIN), off by default.
- A test: no two graphics have the same label in one language.

## Open questions

1. Which tasks deserve a single letter: proposed **B** Block, **C** Clear, **D**
   Disrupt, **F** Fix, **M** Mined area, **R** Retain, **S** Seize. Too many?
2. The 6-letter limit for "short words": DETAINEES and REFUGEES are longer but
   clearer in full. Allow up to 8?
3. The French terms: check against the French Army's own (*Mémento des tâches
   tactiques*, APP-6 in French).
