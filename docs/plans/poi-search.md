# Searching points of interest (plan, 2026-11-24)

Asked (spec 10.124): find shops, restaurants, offices... by name in the search box,
those inside buildings with their floor ("Paul · bakery, Gare Montparnasse, floor 0")
and every other one ("Paul · bakery, Molsheim"). Not started.

## What there is (measured 2026-11-24, France extract of 2026-10-15)

- **1,323,168 named points of interest** (objects with a name and one of shop,
  amenity, office, craft, tourism, leisure, healthcare): 903,534 points, 412,194
  outlines, 7,440 relations; names 21 bytes on average. Cut from the extract in
  2½ minutes (two osmium passes, as for buildings' names: named objects, then these
  keys among them; 97 MB).
- By key: amenity 579,303, shop 369,743, tourism 155,963, office 90,393, leisure
  85,279, craft 29,393, healthcare 13,094. Most common: restaurants 89,213,
  information boards 67,803, schools 61,171, places of worship 56,516, car parks
  33,188, clothes 31,195, hairdressers 30,128, fast food 28,991, town halls 27,056,
  bakeries 25,556.
- Already searched (`search_feature`, 617,016 rows, 192 MB): critical sites (town
  halls, hospitals, schools of the sites' categories, places of worship...),
  infrastructure, named buildings, extra data; places; tower and building numbers;
  coordinates and MGRS. The interiors' named things (62,698) aren't.

## Proposed

1. **Import** (`scripts/pois.py`, a build step after the buildings' names; by hand
   `uv run --project scripts scripts/pois.py`): the two osmium passes; one point each
   (inside its outline); kept per point: OpenStreetMap id, name, kind (`shop=bakery`
   as key and value), floor (level, when written), the building it's in when the
   interiors linked it, a few details for its card (address, opening hours, phone,
   website), into `osm_poi`. The named pass is shared with `building_names.py` (one
   pass for both: 2½ minutes saved).
2. **Left out**, one list for the search and the buildings' "What's inside"
   (a SQL function in `schema/fork/poi.sql`, the backend's list replaced by it, so
   both stay alike): the fittings already left out of the lists (lifts, benches,
   waste baskets, waiting areas, parcel lockers, vending machines, information
   boards, ticket validators, parking spaces and entrances, bicycle parking,
   shelters, pitches); `tourism=information` (68,000 boards and guideposts) too.
   About 1.2 million kept.
3. **Search** (`search.sql`, `search/pois.py`):
   - by name ("paul"), name and town ("paul molsheim"), as now;
   - by kind and town ("boulangerie molsheim", "bakery molsheim"): a table of the
     common kinds' words in French and English (the 100 most frequent, which cover
     90% of the points);
   - the nearest to the map first among equally good matches (the search already
     sends the map's centre): 900 "Paul" bakeries in France, the one near you first;
   - each result says what and where: "Paul · bakery, Molsheim", inside a building
     "Paul · bakery, Gare Montparnasse, floor 0";
   - not twice what's already found as a critical site (same name within 200 m,
     as for buildings' names).
   Its town from the commune it's in (extra data `fr-communes`, a point in a
   polygon, fast) else the nearest place, as the search does now.
4. **Picked:** the map goes there and pins it; its card shows what it is, its
   address, opening hours, phone, website (offline: kept in `osm_poi`), its floor,
   and the building it's in. If that building has a floor plan, its floor is shown.
5. **"What's inside" from `osm_poi`**: the buildings' lists read the same table (a
   building's points by its outline, floors included) instead of decoding the map's
   tiles (`background/pois.py` goes): faster, one source, the same left-out list.

## Size and time (estimates, to check in step 1)

- `osm_poi`: 1.2 million rows of about 120 bytes with their details: about 150 MB
  with its indexes.
- The search: a separate table for points of interest, only what the search needs
  (the plain name, name and town, kind, point; trigram indexes): about 250 MB. Not
  added to `search_feature`, which keeps its 617,000 rows: the infrastructure is
  still searched as fast.
- Together about **400 MB** more in the database and the exports (the France export
  is 2.6 GB). Build: about 6 minutes more (cut 2½, load 1, towns 2, indexes 1).
- If that's too much: leave out the details (−50 MB), or keep only the shops,
  amenities and offices (about 1 million).

## Steps and time

1. Import and measure (`osm_poi`, the shared named pass, tests): half a day.
2. Search: the table, names, kind words, nearest first, towns: a day.
3. Picked: the card, the floor shown: half a day.
4. "What's inside" from `osm_poi`, `background/pois.py` removed: a few hours.

About two and a half days.

## To decide

- Keep car parks (33,000, many named only "Parking")? Artworks (12,700)?
- The cards' details (opening hours, phone, website): kept (50 MB), or not?
- Kind words in French and English only, or more languages?
