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
2. **A letter the standard gives to only one graphic stays** (G Guard, I Isolate,
   P Penetrate, W Withdraw): nothing to tell it apart from. In French too when it
   fits the French word (Isoler I, Percer P).
3. **Short words are written in full**: up to 6 letters (BREACH, SECURE, DELAY).
4. **Longer single words are shortened**, keeping consonants a reader recognises:
   CATK, CNLZ, CNTN.
5. **Several words become their initials**: WUP (withdraw under pressure).
6. **Nothing the drawing already says**: Contain's arrow points at the enemy, so
   CNTN, not CNTN ENEMY.
7. **A variant adds a letter to the main label**: counterattack by fire is CATK F
   (CATK FIRE is too long on the map).
8. **Each label means one thing** in its language. The legend and the item's card
   give the full name next to it: "WUP: Withdraw under pressure".
9. **French uses the French Army's terms**: TTA 106 (the Army's tactical symbols
   and abbreviations, DGA), its *sigles* where it has one (TEN, RETAR, L BO, ZE…);
   ✓ = found there, "(agreed)" = chosen with the project owner, "(to check)" =
   neither yet. Otherwise built by the same rules
   from the French words: RSP (repli sous la pression).
10. **Technical acronyms stay as they are** (fire support, airspace: FSCL, ROZ, FFA…).
   Whoever uses those knows them; the legend spells them out.

## Tactical tasks (the most used)

| Graphic                 | Standard | English | French name                      | French     |
|-------------------------|----------|---------|----------------------------------|------------|
| Block                   | B        | **B**   | Barrer ✓                         | **B**      |
| Breach                  | B        | BREACH  | Bréchage ✓                       | BRCH       |
| Bypass                  | B        | BYPASS  | Contourner ✓                     | CTRN       |
| Canalize                | C        | CNLZ    | Canaliser ✓                      | CNLS       |
| Clear                   | C        | **C**   | Nettoyer (agreed)                | NETT       |
| Contain                 | C ENY    | CNTN    | Contenir ✓                       | CNTN       |
| Counterattack           | CATK     | CATK    | Contre-attaquer ✓ (C.ATK)        | CATK       |
| Counterattack by fire   | CATK     | CATK F  | Contre-attaque par le feu        | CATK F     |
| Cover                   | C        | COVER   | Couvrir ✓ (COUV)                 | COUV       |
| Delay                   | D        | DELAY   | Retarder ✓ (RETAR)               | RETAR      |
| Disrupt                 | D        | **D**   | Désorganiser ✓                   | **D**      |
| Fix                     | F        | **F**   | Fixer ✓ (FIX)                    | **F**      |
| Guard                   | G        | **G**   | Flanc-garder ✓ (G on the symbol) | **G**      |
| Isolate                 | I        | **I**   | Isoler ✓                         | **I**      |
| Occupy                  | O        | **O**   | Occuper ✓                        | **O**      |
| Penetrate               | P        | **P**   | Percer (agreed)                  | **P**      |
| Retain                  | R        | **R**   | Tenir ✓ (TEN)                    | TEN        |
| Retirement              | R        | RTMT    | Retraite                         | RETR       |
| Screen                  | S        | SCREEN  | Surveiller ✓                     | SURV       |
| Secure                  | S        | SECURE  | Sécuriser (agreed)               | SÉCUR      |
| Seize                   | S        | **S**   | Saisir (agreed)                  | SAISIR     |
| Withdraw                | W        | **W**   | (Se) replier ✓ (W on the symbol) | **W**      |
| Withdraw under pressure | WP       | WUP     | Repli sous la pression           | RSP        |
| Relief in place         | RIP      | RIP     | Relève sur position ✓ (RIP)      | **RELÈVE** |

French notes:
- **Withdraw**: the French Army's term is *(se) replier*, and its symbol is marked
  **W** (TTA 106). *Retraite* is **Retirement**. Under pressure: *repli sous la
  pression*, **RSP**.
- **Relief in place**: officially *relève sur position*, marked **RIP** in French
  too; **RELÈVE** as asked (clearer, and no clash).
- **Delay** is *retarder* (RETAR); *freiner* is a task of its own.
- **B** is *barrer* only; *contourner* (bypass) is CTRN.
- **G** (Guard) stays in French as the standard's letter: "FG" for *flanc-garder*
  would be a new code to learn.

## Lines

| Graphic                             | Standard     | English | French name                         | French        |
|-------------------------------------|--------------|---------|-------------------------------------|---------------|
| Bearing line                        | B            | BL      | Ligne de relèvement                 | LRLV          |
| Bridgehead                          | B            | BRHD    | Tête de pont ✓                      | TDP           |
| Phase line                          | PL           | PL      | Ligne de bond ✓ (L BO)              | L BO          |
| Line of departure                   | LD           | LD      | Ligne de débouché ✓                 | LD            |
| Line of contact                     | LC           | LC      | Ligne de contact ✓                  | L CTC         |
| Line of departure / line of contact | LD/LC        | LD/LC   | Débouché / contact                  | LD/L CTC      |
| Limit of advance                    | LOA          | LOA     | Limite avant ✓ (LIMAV)              | LIMAV         |
| Final coordination line             | FCL          | FCL     | Ligne de coordination finale        | LCF           |
| Probable line of deployment         | PLD          | PLD     | Ligne probable de déploiement       | LPD           |
| Holding line                        | HL           | HL      | Ligne de recueil ✓ (LRCL)           | LRCL          |
| Release line                        | RL           | RL      | Ligne de libération                 | LLIB          |
| Light line                          | LL           | LL      | Ligne de feux masqués               | LFM           |
| Forward line of own troops          | FLOT         | FLOT    | Ligne avant des forces amies ✓      | FLOT          |
| Forward edge of battle area         | FEBA         | FEBA    | Limite avant de la zone de bataille | LAZB          |
| Airhead line                        | AIRHEAD LINE | AIRHEAD | Tête aéroportée                     | TAP           |

French: phase line is *ligne de bond* (L BO), line of contact *ligne de contact*
(L CTC), holding line *ligne de recueil* (LRCL), all TTA 106. Release line, light
line, final coordination line and the others without ✓ are still to check.

## Areas and positions

| Graphic                   | Standard     | English | French name                         | French |
|---------------------------|--------------|---------|-------------------------------------|--------|
| Assembly area             | AA           | AA      | Zone de regroupement et d'attente ✓ | ZRA    |
| Assault position          | ASLT         | ASLT    | Position d'assaut (ASS ✓)           | ASS    |
| Attack position           | ATK          | ATK     | Position d'attaque (ATK ✓)          | ATK    |
| Objective                 | OBJ          | OBJ     | Objectif ✓                          | OBJ    |
| Engagement area           | EA           | EA      | Zone d'engagement ✓                 | ZE     |
| Area of operations        | AO           | AO      | Zone d'action ✓                     | ZA     |
| Named area of interest    | NAI          | NAI     | Zone d'intérêt ✓                    | ZI     |
| Targeted area of interest | TAI          | TAI     | Zone d'intérêt ciblée               | ZIC    |
| Limited access area       | LAA          | LAA     | Zone d'accès restreint              | ZAR    |
| Drop zone                 | DZ           | DZ      | Zone de saut ✓                      | ZS     |
| Landing zone              | LZ           | LZ      | Zone de poser                       | ZP     |
| Pickup zone               | PZ           | PZ      | Zone d'embarquement                 | ZEMB   |
| Extraction zone           | EZ           | EZ      | Zone d'extraction                   | ZX     |
| Prepared but not occupied | (P)          | (P)     | Préparée, non occupée               | (P)    |
| Airhead                   | AIRHEAD LINE | AIRHEAD | Tête aéroportée                     | TAP    |

French: ZE is *zone d'engagement* (TTA 106), so the pickup zone is ZEMB.

## Obstacles and mines

| Graphic                       | Standard | English | French name                        | French |
|-------------------------------|----------|---------|------------------------------------|--------|
| Mined area                    | M        | **M**   | Zone minée ✓                       | **M**  |
| Decoy mined area (and fenced) | M        | DECOY M | Zone minée factice                 | M FACT |
| Obstacle free area            | FREE     | FREE    | Zone à laisser libre d'obstacles ✓ | ZLO    |
| Unexploded ordnance area      | UXO      | UXO     | Munitions non explosées            | UXO    |
| Trip wire                     | t        | t       | Fil piège                          | t      |
| Smoke / linear smoke target   | SMOKE    | SMOKE   | Fumigène                           | FUMI   |

## Support and movement

| Graphic                                           | Standard       | English                  | French name                             | French                    |
|---------------------------------------------------|----------------|--------------------------|-----------------------------------------|---------------------------|
| Main supply route                                 | MSR            | MSR                      | Itinéraire principal de ravitaillement  | IPR                       |
| One-way / two-way traffic (on an MSR)             | MSR            | MSR                      | Idem                                    | IPR                       |
| Alternate supply route                            | ASR            | ASR                      | Itinéraire de ravitaillement de secours | IRS                       |
| Alternating traffic                               | ALT ASR        | ALT ASR                  | Circulation alternée                    | IRS ALT                   |
| Forward arming and refuelling point               | FARP           | FARP                     | Point de ravitaillement avancé          | FARP                      |
| Brigade / division / regimental support area      | BSA, DSA, RSA  | BSA, DSA, RSA            | Zone de soutien (brigade…)              | ZSB, ZSD, ZSR             |
| Detainee / EPW / refugee holding area             | AREA … HOLDING | DETAINEES, POW, REFUGEES | Détenus, prisonniers, réfugiés          | DÉTENUS, PRISON, RÉFUGIÉS |
| Electro-optical intercept                         | O              | EO                       | Interception électro-optique            | EO                        |
| Electronic / acoustic / torpedo (decoys, sensors) | E, A, T        | E, A, T                  | Électronique, acoustique, torpille      | E, A, T                   |

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

1. Which of the shared letters go to the most common graphic: proposed **B**
   Block, **C** Clear, **D** Disrupt, **M** Mined area, **O** Occupy, **R** Retain,
   **S** Seize (the others sharing them get a word). Letters only one graphic has
   stay: F, G, I, P, W, and E, A, T, t (decoys, sensors, trip wire).
2. The 6-letter limit for "short words": DETAINEES and REFUGEES are longer but
   clearer in full. Allow up to 8?
3. The French terms marked "(to check)": not in TTA 106 nor agreed yet (release
   line, light line, the logistics routes and zones…). Clear, Penetrate, Secure and
   Seize are agreed: Nettoyer (NETT), Percer (P), Sécuriser (SÉCUR), Saisir (SAISIR). Source used: TTA 106
   *Symboles tactiques* (French Army, DGA), as found online.
