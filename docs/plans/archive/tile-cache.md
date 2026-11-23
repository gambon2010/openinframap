# Plan: a small cache for the joined background tiles

Status: **closed, not built** (2026-11-16). Measured not worth it: a joined tile
costs 1–2 ms (9 ms in central Paris), tiles are small (zoom 14: 6 kB typical; a
screen of central Paris ~2 MB), and the browser already keeps each tile for an hour,
so a server cache would only save a few milliseconds for a second browser or after
the hour. If repeat visits ever need to be faster, a longer browser cache time (with
a recheck after files change) is the simpler lever. Had it been built: `cachetools`
(`LRUCache` sized in bytes), not a cache of our own.

## Why

At zooms 12 to 14 the backend joins each background map tile with its area's
buildings zoomed out (`web-backend/src/fork/background/__init__.py`,
`with_companion`). It unzips both, lays them end to end and zips the result again,
on every request. Measured on France (2026-11-16):

| Tile | Time to serve |
|---|---|
| Joined, central Paris (~140 kB) | 9 ms |
| Joined, a town or the countryside | 1–2 ms |
| Not joined (any other zoom) | 0.2 ms |

Almost all of it is re-zipping. The browser keeps each tile for an hour, so one
person panning around sees this once per tile. The cost comes back for every new
browser or tab, after an hour, and for every device on the network: the same
work, done again for the same bytes.

## What

A cache in the backend's memory of the **joined tiles, zipped**, the bytes exactly
as sent.

- **Key:** the tile (z, x, y) and the two files it came from, each with its
  modification time and size (`Archive.stamp`). A background map downloaded again,
  or its buildings remade, changes the key, so a stale tile can never come back.
  Nothing has to be cleared by hand.
- **Size:** a byte budget, not a tile count (Paris tiles are ten times a village's):
  64 MB, about 500 Paris tiles or several thousand typical ones, roughly a city
  explored at zooms 12–14. The least recently used tiles go first.
- **Only joined tiles.** Untouched tiles are already read straight from the file
  (0.2 ms), and caching them would only use memory.
- **Where:** a small class in `background/__init__.py` (an `OrderedDict` with a
  running byte total, ~25 lines), used by `with_companion`. The backend runs one
  process (one uvicorn worker), so one cache in memory is right; a lock keeps it
  safe across the thread pool tiles are read in.
- **Tests:** a second request for a tile doesn't join again; a replaced companion
  (new stamp) gives the new tile; the budget is kept (the oldest tiles dropped).

About an hour of work.

## Not chosen

- **Sending joined tiles unzipped** and letting the gate compress them (its nginx
  already zips vector tiles): this only moves the same zipping into nginx, it
  doesn't save it.
- **Storing joined tiles in the companion file:** the companion would hold a copy
  of every zoom 12–14 tile of the background map (gigabytes for France) instead of
  56 MB.
- **A cache on disk:** it would outlive the files it was made from, and memory is
  enough for what one session looks at.

## Does it make sense elsewhere in the app?

I looked at everything that serves data. Nowhere else does the same work over and
over for the same answer while also costing enough to notice:

| What | Cost now | Cache? |
|---|---|---|
| Infrastructure tiles (Tegola) | Made from the database, then kept by Tegola's own cache (`tegola/tegola.yml`), which is recreated with each build | Already cached |
| Background tiles, other zooms (backend) | 0.2 ms, read straight from the file | No: nothing to save |
| Satellite imagery (`satellite`, `pmtiles serve`) | Read straight from the files | No: nothing to save |
| A building's whole outline (`/background/building/{id}`) | ~45 ms, once per copy | No: a copy is a rare click, and each is a different building |
| Search, grid routes, line tracing | Different questions each time | No: answers rarely repeat |
| Wikidata in details | Already an offline cache on disk (`data/wikidata_json`, `data/images`) | Already cached |
| Statistics pages (upstream's) | Charts made on each visit | Not worth it: rarely opened, and changing upstream's code makes merges harder |

**A general cache in the gate** (nginx `proxy_cache` in front of every service)
would save each service's repeated work at once. But browsers already keep tiles,
the services are fast, and it would need clearing after every rebuild or download
(Tegola's cache already has to be). Worth it only if several people start using
one machine's map at the same time.

So: cache only the joined tiles.
