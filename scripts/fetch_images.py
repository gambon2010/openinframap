#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx", "psycopg2-binary"]
# ///
"""
Download Wikimedia Commons thumbnails for all OSM features in the local DB.

Queries every table that carries a wikidata tag, then for each ID:
  1. Batch-fetches the P18 (image) claim from the Wikidata API (50 IDs/request)
  2. Batch-fetches thumbnail URLs from the Wikimedia Commons API (50 files/request)
  3. Downloads each thumbnail image to data/images/<wikidata_id>.<ext>

Already-cached images are skipped on re-runs.

Usage:
    uv run scripts/fetch_images.py
    uv run scripts/fetch_images.py --db-url postgresql://osm:osm@localhost:5432/osm

Wikimedia API etiquette: https://www.mediawiki.org/wiki/API:Etiquette
  - Descriptive User-Agent with contact URL
  - No concurrent requests
  - 1 API request per second (Wikidata + Commons MediaWiki endpoints)
  - 1 image download per second (upload.wikimedia.org CDN)
"""

import argparse
import json
import re
import sys
import time
import urllib.parse
from pathlib import Path

import httpx
import psycopg2

import netsafe

REPO_ROOT = Path(__file__).resolve().parent.parent
IMAGES_DIR = REPO_ROOT / "data" / "images"
WIKIDATA_JSON_DIR = REPO_ROOT / "data" / "wikidata_json"

THUMBNAIL_WIDTH = 300
API_DELAY = 1.1  # seconds between MediaWiki API calls (Wikidata / Commons)
IMAGE_DELAY = 1.0  # seconds between image downloads from upload.wikimedia.org


# All tables whose `tags` hstore may carry a wikidata key.
TAGGED_TABLES = [
    "osm_power_plant",
    "osm_power_plant_relation",
    "osm_power_substation",
    "osm_power_substation_relation",
    "osm_power_generator",
    "osm_petroleum_site",
    "osm_mast",
    "osm_marker",
]

WIKIDATA_RE = re.compile(r"^Q[0-9]+$", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------


def get_wikidata_ids(conn) -> set[str]:
    """Return all distinct Wikidata IDs found across every tagged table."""
    ids: set[str] = set()
    cur = conn.cursor()
    for table in TAGGED_TABLES:
        try:
            # `?` is the hstore "contains key" operator; psycopg2 uses %s for
            # its own placeholders so `?` is passed to Postgres unchanged.
            cur.execute(
                f"SELECT DISTINCT tags->'wikidata' FROM {table} WHERE tags ? 'wikidata'"
            )
            for (val,) in cur.fetchall():
                if val and WIKIDATA_RE.match(val):
                    ids.add(val.upper())
        except psycopg2.Error as e:
            print(f"  warning: could not query {table}: {e}", file=sys.stderr)
            conn.rollback()
    cur.close()
    return ids


# ---------------------------------------------------------------------------
# Local cache helpers
# ---------------------------------------------------------------------------


def local_path(wikidata_id: str) -> Path | None:
    """Return the cached file path if it exists, otherwise None."""
    matches = list(IMAGES_DIR.glob(f"{wikidata_id}.*"))
    return matches[0] if matches else None


def chunks(lst: list, n: int):
    for i in range(0, len(lst), n):
        yield lst[i : i + n]


# ---------------------------------------------------------------------------
# Wikimedia API calls
# ---------------------------------------------------------------------------


def fetch_entity_data(client: httpx.Client, ids: list[str]) -> dict[str, dict]:
    """
    Batch-fetch labels, sitelinks and claims from Wikidata for up to 50 IDs.
    Saves each entity to data/wikidata_json/<id>.json for offline use.
    Returns {wikidata_id: entity_dict}.
    """
    url = "https://www.wikidata.org/w/api.php"
    resp = netsafe.safely(
        lambda: netsafe.checked(
            client.get(
                url,
                params={
                    "action": "wbgetentities",
                    "ids": "|".join(ids),
                    # sitelinks/urls includes the full Wikipedia URL in each sitelink entry
                    "props": "claims|labels|sitelinks/urls",
                    "format": "json",
                },
            )
        ),
        url,
    )
    result: dict[str, dict] = {}
    for entity_id, entity in resp.json().get("entities", {}).items():
        if "missing" in entity:
            continue
        uid = entity_id.upper()
        result[uid] = entity
        cache_file = WIKIDATA_JSON_DIR / f"{uid}.json"
        if not cache_file.exists():
            cache_file.write_text(json.dumps(entity))
    return result


def fetch_thumbnail_urls(client: httpx.Client, filenames: list[str]) -> dict[str, str]:
    """
    Batch-fetch thumbnail URLs from Wikimedia Commons for up to 50 filenames.
    Returns {commons_filename: thumb_url}.
    """
    url = "https://commons.wikimedia.org/w/api.php"
    resp = netsafe.safely(
        lambda: netsafe.checked(
            client.get(
                url,
                params={
                    "action": "query",
                    "titles": "|".join(f"File:{f}" for f in filenames),
                    "prop": "imageinfo",
                    "iiprop": "url",
                    "iiurlwidth": str(THUMBNAIL_WIDTH),
                    "format": "json",
                },
            )
        ),
        url,
    )
    result: dict[str, str] = {}
    for page in resp.json()["query"]["pages"].values():
        if "imageinfo" not in page:
            continue
        filename = page["title"].removeprefix("File:")
        result[filename] = page["imageinfo"][0]["thumburl"]
    return result


def download_image(client: httpx.Client, url: str, wikidata_id: str) -> Path:
    resp = netsafe.safely(
        lambda: netsafe.checked(client.get(url, follow_redirects=True)), url
    )
    ext = Path(urllib.parse.urlparse(url).path).suffix.lower() or ".jpg"
    dest = IMAGES_DIR / f"{wikidata_id}{ext}"
    dest.write_bytes(resp.content)
    return dest


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def collect_p361_ids(entities: dict[str, dict]) -> set[str]:
    """
    Return Wikidata IDs referenced by P361 ("part of") claims in the given
    entities that are not already cached on disk.

    P361 links a feature to its parent — e.g. an offshore wind turbine to its
    wind farm. The backend resolves these recursively to build the popup's
    "part of" section. Without pre-caching them the section is silently empty
    when offline.
    """
    ids: set[str] = set()
    for entity in entities.values():
        for claim in entity.get("claims", {}).get("P361", []):
            try:
                ref_id = claim["mainsnak"]["datavalue"]["value"]["id"].upper()
            except (KeyError, TypeError):
                continue
            if (
                WIKIDATA_RE.match(ref_id)
                and not (WIKIDATA_JSON_DIR / f"{ref_id}.json").exists()
            ):
                ids.add(ref_id)
    return ids


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Cache Wikimedia thumbnails locally.")
    parser.add_argument(
        "--db-url",
        default="postgresql://osm:osm@localhost:5432/osm",
        help="PostgreSQL connection URL (default: postgresql://osm:osm@localhost:5432/osm)",
    )
    parser.add_argument(
        "--json-only",
        action="store_true",
        help=(
            "Only fetch and cache entity JSON (labels, sitelinks, claims). "
            "Skips image download (~10 sec vs ~8 min). "
            "Sufficient for offline popup metadata; run without this flag later to add images."
        ),
    )
    parser.add_argument(
        "--count",
        action="store_true",
        help="Print '<IDs missing entity JSON> <IDs missing an image>' as the last line and exit (used by launch.sh).",
    )
    return parser.parse_args()


def wikidata_ids(db_url: str, quiet: bool) -> set[str]:
    """Every wikidata ID the map's tables have."""
    if not quiet:
        print("Connecting to database...")
    try:
        conn = psycopg2.connect(db_url)
    except psycopg2.OperationalError as e:
        sys.exit(f"ERROR: could not connect to database: {e}")
    if not quiet:
        print("Collecting wikidata IDs from all tagged tables...")
    ids = get_wikidata_ids(conn)
    conn.close()
    print(f"  {len(ids)} distinct wikidata IDs found")
    return ids


def image_of(entity: dict) -> str | None:
    """An entity's image (P18): its Commons file name."""
    claims = entity.get("claims", {})
    if "P18" not in claims:
        return None
    snak = claims["P18"][0]["mainsnak"]
    return (
        snak["datavalue"]["value"] if snak.get("datatype") == "commonsMedia" else None
    )


def step_entities(
    client: httpx.Client, todo: list[str], steps: str
) -> tuple[dict[str, dict], dict[str, str]]:
    """Step 1: the entities' data from Wikidata (50 IDs a request), saved to
    data/wikidata_json/ (those already there are read from it), then the ones they
    are part of (P361), one level deep, for the popup's "part of" offline. Returns
    the entities, and the image file of each ID that has none here yet."""
    fetched: dict[str, dict] = {}
    todo_api: list[str] = []
    for uid in todo:
        cache_file = WIKIDATA_JSON_DIR / f"{uid}.json"
        try:
            fetched[uid] = json.loads(cache_file.read_text())
        except (json.JSONDecodeError, OSError):
            todo_api.append(uid)
    print(
        f"\nStep 1{steps}  Wikidata entity data "
        f"({len(todo_api)} API, {len(fetched)} from cache, 50/request, 1 req/sec)"
    )
    batches = list(chunks(todo_api, 50))
    for i, batch in enumerate(batches, 1):
        print(f"  batch {i}/{len(batches)} ({len(batch)} IDs) ...", end=" ", flush=True)
        try:
            entities = fetch_entity_data(client, batch)
            fetched.update(entities)
            print(f"{len(entities)} fetched")
        except httpx.HTTPError as e:
            print(f"FAILED ({e})", file=sys.stderr)
        if i < len(batches):
            time.sleep(API_DELAY)

    p361_ids = collect_p361_ids(fetched)
    if p361_ids:
        print(f"\n  Following {len(p361_ids)} P361 'part of' references...")
        for i, batch in enumerate(chunks(sorted(p361_ids), 50), 1):
            time.sleep(API_DELAY)
            print(f"    batch {i}: {len(batch)} IDs ...", end=" ", flush=True)
            try:
                entities = fetch_entity_data(client, batch)
                print(f"{len(entities)} cached")
            except httpx.HTTPError as e:
                print(f"FAILED ({e})", file=sys.stderr)

    images = {
        uid: image
        for uid, entity in fetched.items()
        if not local_path(uid) and (image := image_of(entity))
    }
    return fetched, images


def step_thumbnail_urls(client: httpx.Client, images: dict[str, str]) -> dict[str, str]:
    """Step 2: the thumbnails' URLs from Commons (50 files a request), by ID."""
    print(
        f"\nStep 2/3  Commons thumbnail URLs ({len(images)} files, 50/request, 1 req/sec)"
    )
    urls: dict[str, str] = {}
    batches = list(chunks(list(images.values()), 50))
    for i, batch in enumerate(batches, 1):
        if i > 1:
            time.sleep(API_DELAY)
        print(
            f"  batch {i}/{len(batches)} ({len(batch)} files) ...", end=" ", flush=True
        )
        try:
            got = fetch_thumbnail_urls(client, batch)
            urls.update(got)
            print(f"got {len(got)} URLs")
        except httpx.HTTPError as e:
            print(f"FAILED ({e})", file=sys.stderr)
    return {uid: urls[name] for uid, name in images.items() if name in urls}


def step_images(client: httpx.Client, downloads: dict[str, str]) -> tuple[int, int]:
    """Step 3: the images (1 a second, from Commons' CDN): (downloaded, failed)."""
    print(f"\nStep 3/3  Downloading {len(downloads)} images (1/sec)")
    ok = fail = 0
    for i, (wid, url) in enumerate(sorted(downloads.items()), 1):
        print(f"  [{i:3d}/{len(downloads)}] {wid} ...", end=" ", flush=True)
        try:
            path = download_image(client, url, wid)
            print(f"OK  {path.name}  ({path.stat().st_size // 1024} KB)")
            ok += 1
        except (httpx.HTTPError, OSError) as e:
            print(f"FAILED: {e}", file=sys.stderr)
            fail += 1
        if i < len(downloads):
            time.sleep(IMAGE_DELAY)
    return ok, fail


def main() -> None:
    args = parse_args()
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    WIKIDATA_JSON_DIR.mkdir(parents=True, exist_ok=True)
    all_ids = wikidata_ids(args.db_url, quiet=args.count)
    todo_json = sorted(
        id_ for id_ in all_ids if not (WIKIDATA_JSON_DIR / f"{id_}.json").exists()
    )
    todo_image = sorted(id_ for id_ in all_ids if not local_path(id_))
    if args.count:
        print(len(todo_json), len(todo_image))
        return
    todo = sorted(set(todo_json) | set(todo_image if not args.json_only else []))
    already_cached = len(all_ids) - len(set(todo_json) | set(todo_image))
    print(
        f"  {already_cached} fully cached  |  "
        f"{len(todo_json)} missing entity JSON  |  "
        f"{len(todo_image)} missing image"
        + ("  [--json-only: skipping images]" if args.json_only else "")
    )
    if not todo:
        print("Nothing to do.")
        return
    if not args.json_only:
        print(
            f"\nEstimated time: ~{len(todo_image) * IMAGE_DELAY / 60:.0f} min "
            f"(use --json-only for metadata-only run in ~10 sec)"
        )

    with httpx.Client(headers={"User-Agent": netsafe.USER_AGENT}, timeout=30) as client:
        fetched, images = step_entities(client, todo, "/1" if args.json_only else "/3")
        if args.json_only:
            print(f"\nDone (--json-only) — entity JSON cached for {len(fetched)} IDs.")
            print(f"Run without --json-only to download {len(images)} images.")
            return
        if not images:
            print("Entity JSON saved. No new images to download.")
            return
        print(f"  {len(images)} IDs need image downloads")
        downloads = step_thumbnail_urls(client, images)
        if not downloads:
            print("No thumbnail URLs resolved — nothing to download.")
            return
        ok, fail = step_images(client, downloads)

    print(
        f"\nDone — {ok} images downloaded, {fail} failed, {already_cached} fully cached."
    )
    print(f"Images:      {IMAGES_DIR}")
    print(f"Entity JSON: {WIKIDATA_JSON_DIR}")


if __name__ == "__main__":
    netsafe.run_until_connected(main)
