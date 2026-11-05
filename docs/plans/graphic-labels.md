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
9. **French uses the French Army's terms**, even less common ones; an English
   acronym or word where French military usage keeps it (LZ, FEBA, MSR, black-out).
   Source: TTA 106 (the Army's tactical symbols
   and abbreviations, DGA), its *sigles* where it has one (TEN, RETAR, L BO, ZE…);
   ✓ = found there, "(agreed)" = chosen with the project owner, "(to check)" =
   neither yet. Otherwise built by the same rules
   from the French words: RSP (repli sous la pression).
11. **A French label never means something else in French doctrine**: each is
   checked against TTA 106's abbreviations and the letters on its task symbols.
   P is *pénétrante* there (a road), so Penetrate is PERCER; EMB is *embuscade*,
   so Z-EMB; ZS is both *zone de saut* and *zone de soutien*, so the drop zone is
   DZ; LIMAV is the forward boundary, so the limit of advance stays LOA. The test
   that keeps labels unique also checks them against TTA 106's list.
10. **Technical acronyms stay as they are** (fire support, airspace: FSCL, ROZ, FFA…).
   Whoever uses those knows them; the legend spells them out.

## Tactical tasks (the most used)

| Graphic                 | Standard | English | French name                                   | French     |
|-------------------------|----------|---------|-----------------------------------------------|------------|
| Block                   | B        | **B**   | Barrer ✓                                      | **B**      |
| Breach                  | B        | BREACH  | Bréchage ✓                                    | BRCH       |
| Bypass                  | B        | BYPASS  | Contourner ✓                                  | CTRN       |
| Canalize                | C        | CNLZ    | Canaliser ✓                                   | CNLS       |
| Clear                   | C        | **C**   | Nettoyer (agreed)                             | NETT       |
| Contain                 | C ENY    | CNTN    | Contenir ✓                                    | CNTN       |
| Counterattack           | CATK     | CATK    | Contre-attaquer ✓ (C.ATK)                     | CATK       |
| Counterattack by fire   | CATK     | CATK F  | Contre-attaque par le feu                     | CATK F     |
| Cover                   | C        | COVER   | Couvrir ✓ (COUV)                              | COUV       |
| Delay                   | D        | DELAY   | Retarder ✓ (RETAR)                            | RETAR      |
| Disrupt                 | D        | **D**   | Désorganiser ✓                                | **D**      |
| Fix                     | F        | **F**   | Fixer ✓ (FIX)                                 | **F**      |
| Guard                   | G        | **G**   | Flanc-garder ✓ (G on the symbol)              | **G**      |
| Isolate                 | I        | **I**   | Isoler ✓                                      | **I**      |
| Occupy                  | O        | **O**   | Occuper ✓                                     | **O**      |
| Penetrate               | P        | **P**   | Percer (agreed; P is *pénétrante* in TTA 106) | PERCER     |
| Retain                  | R        | **R**   | Tenir ✓ (TEN)                                 | TEN        |
| Retirement              | R        | RETIRE  | Mouvement rétrograde (agreed)                 | RETRO      |
| Screen                  | S        | SCREEN  | Surveiller ✓                                  | SURV       |
| Secure                  | S        | SECURE  | Contrôler une zone ✓ (CTR. Z) (agreed)        | CTR-Z      |
| Seize                   | S        | **S**   | Saisir (agreed)                               | SAISIR     |
| Withdraw                | W        | **W**   | (Se) replier ✓ (W on the symbol)              | **W**      |
| Withdraw under pressure | WP       | WUP     | Repli sous la pression                        | RSP        |
| Relief in place         | RIP      | RIP     | Relève sur position ✓ (RIP)                   | **RELÈVE** |

French notes:
- **Withdraw**: the French Army's term is *(se) replier*, and its symbol is marked
  **W** (TTA 106). *Retraite* is **Retirement**. Under pressure: *repli sous la
  pression*, **RSP**.
- **Relief in place**: officially *relève sur position*, marked **RIP** in French
  too; **RELÈVE** as asked (clearer, and no clash).
- **Delay** is *retarder* (RETAR); *freiner* is a task of its own.
- Moving back, three ways: **Delay** (in contact, giving ground to gain time:
  *retarder*, RETAR), **Withdraw** (breaking contact: *(se) replier*, W; under
  pressure: *repli sous la pression*, RSP), **Retirement** (not in contact, moving
  rearwards as a march: *mouvement rétrograde*, RETRO). No two share a word.
- **B** is *barrer* only; *contourner* (bypass) is CTRN.
- **G** (Guard) stays in French as the standard's letter: "FG" for *flanc-garder*
  would be a new code to learn.

## Lines

| Graphic                             | Standard     | English | French name                                       | French |
|-------------------------------------|--------------|---------|---------------------------------------------------|--------|
| Bearing line                        | B            | BRG     | Ligne de relèvement (agreed)                      | AZIMUT |
| Bridgehead                          | B            | BRHD    | Tête de pont ✓                                    | TDP    |
| Phase line                          | PL           | PL      | Ligne de bond ✓ (L BO)                            | L BO   |
| Line of departure                   | LD           | LD      | Ligne de débouché ✓                               | LD     |
| Line of contact                     | LC           | LC      | Ligne de contact ✓                                | L CTC  |
| Line of departure / line of contact | LD/LC        | LD/C    | Ligne de débouché / contact (agreed)              | LD/C   |
| Limit of advance                    | LOA          | LOA     | LOA until checked (LIMAV is the forward boundary) | LOA    |
| Final coordination line             | FCL          | FCL     | FCL, kept in French like FSCL (agreed)            | FCL    |
| Probable line of deployment         | PLD          | PLD     | Ligne de prise de déploiement opérationnel ✓      | LPDO   |
| Holding line                        | HL           | HL      | Ligne de recueil ✓ (LRCL)                         | LRCL   |
| Release line                        | RL           | RL      | Ligne d'identification et d'accueil ✓ (agreed)    | LIA    |
| Light line                          | LL           | LL      | Ligne de feux masqués, black-out (agreed)         | BLK    |
| Forward line of own troops          | FLOT         | FLOT    | Ligne avant des forces amies ✓                    | FLOT   |
| Forward edge of battle area         | FEBA         | FEBA    | FEBA, kept in French (agreed)                     | FEBA   |
| Airhead line                        | AIRHEAD LINE | AIRHEAD | Tête de pont aéroportée (agreed)                  | TPA    |

French: phase line is *ligne de bond* (L BO), line of contact *ligne de contact*
(L CTC), holding line *ligne de recueil* (LRCL), all TTA 106. English acronyms are
kept where French military usage keeps them (FLOT, FEBA, FSCL, FCL, LZ, MSR).

What some lines mean:
- **Bearing line**: from an observer or sensor (direction finder, radar, sonar)
  along the direction it detected something; two crossing ones locate it.
  *Relèvement* = bearing.
- **Light line**: beyond it, vehicles drive with blackout lights (*feux masqués*),
  no headlights.

## Areas and positions

| Graphic                   | Standard     | English | French name                         | French |
|---------------------------|--------------|---------|-------------------------------------|--------|
| Assembly area             | AA           | AA      | Zone de regroupement et d'attente ✓ | ZRA    |
| Assault position          | ASLT         | ASLT    | Position d'assaut (agreed)          | ASSAUT |
| Attack position           | ATK          | ATK     | Position d'attaque (ATK ✓)          | ATK    |
| Objective                 | OBJ          | OBJ     | Objectif ✓                          | OBJ    |
| Engagement area           | EA           | EA      | Zone d'engagement ✓                 | ZE     |
| Area of operations        | AO           | AO      | Zone d'action ✓                     | ZA     |
| Named area of interest    | NAI          | NAI     | Zone d'intérêt du renseignement ✓   | ZIR    |
| Targeted area of interest | TAI          | TAI     | Zone d'intérêt des objectifs ✓      | ZIO    |
| Limited access area       | LAA          | LAA     | Zone d'accès restreint (agreed)     | ZRES   |
| Drop zone                 | DZ           | DZ      | DZ, as used in French (agreed)      | DZ     |
| Landing zone              | LZ           | LZ      | LZ, as used in French (agreed)      | LZ     |
| Pickup zone               | PZ           | PZ      | Zone d'embarquement (agreed)        | Z-EMB  |
| Extraction zone           | EZ           | EZ      | Zone d'exfiltration (agreed)        | Z-EXF  |
| Prepared but not occupied | (P)          | (P)     | Préparée, non occupée               | (P)    |
| Airhead                   | AIRHEAD LINE | AIRHEAD | Tête de pont aéroportée (agreed)    | TPA    |

French: ZE is *zone d'engagement* (TTA 106). LZ is kept as French speech uses it.
A zone keeps its Z like French doctrine's (ZE, ZA, ZRA…); where the rest is an
abbreviation of its own, it's joined with a hyphen: Z-EMB (*zone d'embarquement*:
EMB alone is *embuscade* in TTA 106), Z-EXF (*zone d'exfiltration*).

## Obstacles and mines

| Graphic                       | Standard | English | French name                        | French |
|-------------------------------|----------|---------|------------------------------------|--------|
| Mined area                    | M        | **M**   | Zone minée ✓                       | **M**  |
| Decoy mined area (and fenced) | M        | DECOY M | Zone minée factice                 | M FACT |
| Obstacle free area            | FREE     | FREE    | Zone à laisser libre d'obstacles ✓ | ZLO    |
| Unexploded ordnance area      | UXO      | UXO     | Munitions non explosées            | UXO    |
| Trip wire                     | t        | t       | Fil tendu (agreed)                 | t      |
| Smoke / linear smoke target   | SMOKE    | SMOKE   | Fumigène (agreed)                  | FUMI   |

## Support and movement

| Graphic                                           | Standard       | English                  | French name                                              | French                  |
|---------------------------------------------------|----------------|--------------------------|----------------------------------------------------------|-------------------------|
| Main supply route                                 | MSR            | MSR                      | MSR, kept in French (agreed)                             | MSR                     |
| One-way / two-way traffic (on an MSR)             | MSR            | MSR                      | MSR, kept in French (agreed)                             | MSR                     |
| Alternate supply route                            | ASR            | ASR                      | ASR, kept in French (agreed)                             | ASR                     |
| Alternating traffic                               | ALT ASR        | ALT ASR                  | Circulation alternée (agreed)                            | ASR ALT                 |
| Forward arming and refuelling point               | FARP           | FARP                     | Point de ravitaillement avancé                           | FARP                    |
| Brigade / division / regimental support area      | BSA, DSA, RSA  | BSA, DSA, RSA            | Zone de soutien ✓ (agreed)                               | ZS BRIG, ZS DIV, ZS RGT |
| Detainee / EPW / refugee holding area             | AREA … HOLDING | DETAINEES, POW, REFUGEES | Zones: détenus, prisonniers de guerre, réfugiés (agreed) | Z-DÉT, Z-PG, Z-RÉF      |
| Electro-optical intercept                         | O              | EO                       | Interception électro-optique (agreed)                    | IEO                     |
| Electronic / acoustic / torpedo (decoys, sensors) | E, A, T        | E, A, T                  | Électronique, acoustique, torpille                       | E, A, T                 |

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
