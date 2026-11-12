"""Fork: satellite imagery. IGN's aerial photos of France (BD ORTHO, 20 cm), as the
files IGN publishes for bulk use, one département at a time: IGN's tile server
blocks a computer that asks for its tiles by the million (2026-11-06).

For each département: find its latest edition (IGN's download service, an Atom
listing), download its 7z archive (parts of 4 GB, a few at once, resumed where they
stopped, each checked against IGN's md5), extract the JPEG 2000 images, turn them
into WebP web tiles to the zoom asked for (GDAL), and keep only that: one PMTiles
file per département (<area>.sat-detailed-fr_ign.pmtiles). The archive and the
images are deleted as soon as they've been used, so the disk holds one
département's at a time. A département already there to that zoom is skipped."""

from __future__ import annotations

import hashlib
import math
import os
import re
import shutil
import subprocess
import sys
import threading
import urllib.parse
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import netsafe

from . import inventory
from .departements import DEPARTEMENTS
from .download import MBTiles
from .gdal import docker_run, to_pmtiles
from .pmtiles import read_header
from .sources import AERIAL_FIRST_ZOOM, EARTH_CIRCUMFERENCE_M, SOURCES
from .tiles import tile_bounds

LISTING = "https://data.geopf.fr/telechargement/resource/BDORTHO"
# The colour photos, 20 cm, JPEG 2000, Lambert 93: BDORTHO_2-0_RVB-0M20_JP2-E080_
# LAMB93_D067_2024-01-01 (version, département, edition).
EDITION = re.compile(
    r"^BDORTHO_(\d+)-(\d+)_RVB-0M20_JP2-E080_LAMB93_D(\w{3})_(\d{4}-\d{2}-\d{2})$"
)
ATOM = "{http://www.w3.org/2005/Atom}"
GPF = "{https://data.geopf.fr/annexes/ressources/xsd/gpf_dl.xsd}"
# Archive parts downloaded at once (IGN's service sends each one slowly).
PARTS_AT_ONCE = 3
# From zoom 12, as every aerial source; the two zooms below 14 add about 8%.
MINZOOM = AERIAL_FIRST_ZOOM
# WebP quality of the tiles: smaller than IGN's JPEG, still sharp.
QUALITY = 75
# Threads making tiles at once: with all 32 cores, gdal raster tile fails to
# write a tile every few thousand ("Unable to create WEBP file", three times in a
# row on Bas-Rhin); 8 never did, and is nearly as fast.
TILE_THREADS = min(8, os.cpu_count() or 8)
# GDAL 3.11 for `gdal raster tile` (every core, every zoom); Sentinel-2 stays on
# sources.GDAL_IMAGE.
TILER_IMAGE = "ghcr.io/osgeo/gdal:alpine-small-3.11.4"
# How fast IGN's download service sends its files (several at once), for the
# times shown before a download.
DOWNLOAD_BYTES_PER_SECOND = 3_000_000
# Sizes (sources/fr_ign.py): the archive per km², and a WebP tile on average.
ARCHIVE_BYTES_PER_KM2 = SOURCES["fr_ign"].read_per_km2
WEBP_TILE_BYTES = SOURCES["fr_ign"].tile_bytes

# --- Which département ---------------------------------------------------------


def area_name(code: str) -> str:
    """A département's file name: fr-67 (<area>.sat-detailed-fr_ign.pmtiles)."""
    return f"fr-{code.lower()}"


def file_of(folder: Path, code: str) -> Path:
    """A département's tiles: <folder>/fr-67.sat-detailed-fr_ign.pmtiles."""
    return folder / f"{area_name(code)}.sat-detailed-fr_ign.pmtiles"


def departements_in(region: str, within) -> list[str]:
    """The départements in an area (france, alsace, europe...), by code; within(a,
    b): whether region a is region b or inside it (Geofabrik's index)."""
    return [
        code
        for code, (_, _, _, home) in DEPARTEMENTS.items()
        if region == "world" or within(home, region)
    ]


def tiles_of(code: str, maxzoom: int, minzoom: int = MINZOOM) -> int:
    """The tiles a département's file has, its zooms minzoom to maxzoom (its
    area over a tile's at its latitude)."""
    _, km2, (_, south, _, north), _ = DEPARTEMENTS[code]
    stretch = math.cos(math.radians((south + north) / 2))
    total = 0
    for z in range(minzoom, maxzoom + 1):
        side_km = EARTH_CIRCUMFERENCE_M / 2**z * stretch / 1000
        total += math.ceil(km2 / side_km**2)
    return total


def estimate(codes: list[str], maxzoom: int) -> dict:
    """What downloading these départements to a zoom takes: kept on disk, read."""
    return {
        "bytes": sum(tiles_of(c, maxzoom) for c in codes) * WEBP_TILE_BYTES,
        "download": sum(DEPARTEMENTS[c][1] for c in codes) * ARCHIVE_BYTES_PER_KM2,
    }


# --- The units, for the offline maps menu (sources/fr_ign.py: units) -------------
# A converter of a source fetched as files, one unit at a time, has these: the
# units in an area, their names, which unit a file is, the jobs stopped half-way.

units_in = departements_in
unit_file = file_of
unit_estimate = estimate
# A département's work folder (kept between runs: a stopped download goes on).
WORK_PREFIX = ".bdortho-"


def unit_name(code: str) -> str:
    return DEPARTEMENTS[code][0]


def unit_code(typed: str) -> str:
    """A département's code as typed ("2a", "1"): "2A", "01"."""
    return typed.upper() if typed[-1:].isalpha() else typed.zfill(2)


def unit_of(file_area: str) -> str | None:
    """The département of a file's area name (fr-67 → 67, fr-2a → 2A)."""
    code = file_area.removeprefix("fr-").upper()
    return code if file_area.startswith("fr-") and code in DEPARTEMENTS else None


def work_of(folder: Path, code: str) -> Path:
    return folder / f"{WORK_PREFIX}{code}"


def jobs(folder: Path) -> list[dict]:
    """The départements started and not finished (their work folders): how far
    the download got (bytes so far, of about how many), why it stopped if it
    said, the edition."""
    out = []
    for work in sorted(folder.glob(f"{WORK_PREFIX}*")):
        code = work.name[len(WORK_PREFIX) :]
        if code not in DEPARTEMENTS or not work.is_dir():
            continue
        of = DEPARTEMENTS[code][1] * ARCHIVE_BYTES_PER_KM2
        converting = (work / "images").exists()
        have = (
            of
            if converting
            else sum(f.stat().st_size for f in work.glob("*.7z.*") if f.is_file())
        )
        names = [f.name for f in work.glob("*.7z.*")]
        edition = next(
            (m[4] for n in names if (m := EDITION.match(n.split(".")[0]))), ""
        )
        stopped = work / "stopped"
        out.append(
            {
                "unit": code,
                "work": work.name,
                "have": have,
                "of": max(of, have),
                "phase": "converting" if converting else "download",
                "reason": stopped.read_text().strip() if stopped.exists() else "",
                "edition": (work / "edition").read_text().strip()
                if (work / "edition").exists()
                else edition,
            }
        )
    return out


# --- IGN's download service -----------------------------------------------------------


def atom(url: str) -> ET.Element:
    data = netsafe.fetch(url)
    if data is None:
        raise RuntimeError(f"Nothing at {url}")
    return ET.fromstring(data)


def entries(url: str) -> list[ET.Element]:
    """Every entry of an Atom listing (it comes in pages)."""
    found: list[ET.Element] = []
    page = 1
    while True:
        sep = "&" if "?" in url else "?"
        feed = atom(f"{url}{sep}page={page}")
        batch = feed.findall(f"{ATOM}entry")
        found += batch
        total = int(feed.get(f"{GPF}totalentries") or feed.get("totalentries") or 0)
        if not batch or len(found) >= total:
            return found
        page += 1


def latest_edition(code: str) -> str:
    """The newest colour 20 cm edition of a département (its resource name)."""
    zone = f"D{code.zfill(3)}"
    editions = []
    for entry in entries(f"{LISTING}?zone={zone}"):
        title = (entry.findtext(f"{ATOM}title") or "").strip()
        match = EDITION.match(title)
        if match and match.group(3) == zone[1:]:
            major, minor, _, date = match.groups()
            editions.append((date, int(major), int(minor), title))
    if not editions:
        raise RuntimeError(f"IGN has no 20 cm colour photos of département {code}.")
    return max(editions)[-1]


def archive_files(resource: str) -> tuple[list[tuple[str, int]], str | None]:
    """The archive's parts (URL, size), in order, and its md5 list's URL."""
    parts, md5 = [], None
    for entry in entries(f"{LISTING}/{urllib.parse.quote(resource)}"):
        link = entry.find(f"{ATOM}link")
        if link is None:
            continue
        href = link.get("href", "")
        if href.endswith(".md5"):
            md5 = href
        elif re.search(r"\.7z(\.\d+)?$", href):
            # Its size: gpf_dl:length (IGN's namespace), as the listing gives it.
            size = link.get(f"{GPF}length") or link.get("length") or 0
            parts.append((href, int(size)))
    return sorted(parts), md5


# --- Downloading and extracting -------------------------------------------------------


def md5_of(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as f:
        while chunk := f.read(1 << 24):
            digest.update(chunk)
    return digest.hexdigest()


def expected_md5(md5_url: str | None) -> dict[str, str]:
    """IGN's md5 of each part, by file name."""
    if not md5_url:
        return {}
    text = (netsafe.fetch(md5_url) or b"").decode()
    sums = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 2:
            sums[Path(parts[1]).name] = parts[0]
    return sums


def download_archive(
    resource: str, work: Path, limit: netsafe.RateLimit | None = None
) -> Path:
    """The département's archive in `work` (resumed, checked); its first part."""
    parts, md5_url = archive_files(resource)
    if not parts:
        raise RuntimeError(f"No archive in IGN's listing of {resource}.")
    sums = expected_md5(md5_url)
    total = sum(size for _, size in parts)
    lock = threading.Lock()
    done = [
        sum(
            (work / Path(u).name).stat().st_size
            if (work / Path(u).name).exists()
            else (work / (Path(u).name + ".part")).stat().st_size
            if (work / (Path(u).name + ".part")).exists()
            else 0
            for u, _ in parts
        )
    ]

    def progress(n: int) -> None:
        with lock:
            done[0] += n
            print(
                f"\r  {done[0] / 1e9:.1f}/{total / 1e9:.1f} GB downloaded",
                end="",
                file=sys.stderr,
                flush=True,
            )

    def one(url: str) -> None:
        path = work / Path(urllib.parse.urlsplit(url).path).name
        for attempt in (1, 2):
            netsafe.fetch_file(url, path, progress=progress, limit=limit)
            want = sums.get(path.name)
            if not want or md5_of(path) == want:
                return
            path.unlink()  # damaged on the way: once more
            if attempt == 2:
                raise RuntimeError(
                    f"{path.name} arrives damaged (md5): try again later."
                )

    with ThreadPoolExecutor(max_workers=PARTS_AT_ONCE) as pool:
        list(pool.map(one, [u for u, _ in parts]))
    print(file=sys.stderr)
    return work / Path(urllib.parse.urlsplit(parts[0][0]).path).name


def extract(first_part: Path, into: Path, gdal_image: str) -> list[Path]:
    """The JPEG 2000 images of an archive (all its parts), extracted into `into`;
    the archive is deleted then. 7-Zip: this computer's, else in Docker."""
    into.mkdir(exist_ok=True)
    if shutil.which("7z"):
        subprocess.run(
            [
                "7z",
                "x",
                "-y",
                "-bso0",
                "-bsp0",
                f"-o{into}",
                str(first_part),
                "*.jp2",
                "-r",
            ],
            check=True,
            stdin=subprocess.DEVNULL,
        )
    else:
        work = first_part.parent
        subprocess.run(
            [
                "docker",
                "run",
                "--rm",
                "-v",
                f"{work}:/w:z",
                "-w",
                "/w",
                gdal_image,
                "sh",
                "-c",
                (
                    f"apk add -q --no-cache 7zip && 7z x -y -bso0 -bsp0 -o/w/{into.name} "
                    f"/w/{first_part.name} '*.jp2' -r "
                    f"&& chown -R {os.getuid()}:{os.getgid()} /w/{into.name}"
                ),
            ],
            check=True,
            stdin=subprocess.DEVNULL,
        )
    archive = first_part.name.removesuffix(".001")  # X.7z, or X.7z.001 and on
    for part in first_part.parent.iterdir():
        if part.name == archive or re.fullmatch(
            re.escape(archive) + r"\.\d+", part.name
        ):
            part.unlink()
    images = sorted(into.rglob("*.jp2"))
    if not images:
        raise RuntimeError(f"No JPEG 2000 images in {first_part.name}.")
    return images


# --- Making the tiles -------------------------------------------------------------------


def pipeline(maxzoom: int, minzoom: int = MINZOOM) -> str:
    """The GDAL commands (run in `work`, the images listed in images.txt) that make
    the département's tiles into tiles-z<maxzoom>/z/x/y.webp. First one image of it
    all, reprojected to the web map at the last zoom's resolution (GDAL reads each
    JPEG 2000 at the reduced resolution it needs, on every core; JPEG inside, with
    transparency outside the photos). Then each zoom straight from that image, on
    every core (gdal raster tile, GDAL 3.11): a lower zoom made from the tiles
    above it would read them while they're being written.
    Measured on Paris (13 images of 5 km, zoom 17): 1 min 18 s; the virtual mosaic
    of the images reprojected on the fly took over 15 min (each image read whole at
    20 cm).
    Run again after it stopped, it goes on: the reprojected image is kept once
    complete (written under another name until then), and a zoom's tiles already
    made are kept (--resume). gdal raster tile now and then fails to write one
    tile ("Unable to create WEBP file", its threads tripping over each other), less
    so with fewer threads (TILE_THREADS): each zoom is tried up to three times, the
    next tries making only what's missing."""
    resolution = EARTH_CIRCUMFERENCE_M / 256 / 2**maxzoom
    warped, tiles = f"warped-z{maxzoom}.tif", f"tiles-z{maxzoom}"
    tile = (
        f"gdal raster tile --format WEBP --co QUALITY={QUALITY} -r average "
        f"--skip-blank --webviewer none -j {TILE_THREADS} --resume {warped} {tiles}"
    )
    return " && ".join(
        [
            (
                f"{{ [ -f {warped} ] || gdalwarp -q -multi -wo NUM_THREADS=ALL_CPUS "
                f"-t_srs EPSG:3857 -tr {resolution} {resolution} -r bilinear -dstalpha "
                "-co TILED=YES -co COMPRESS=JPEG -co JPEG_QUALITY=90 -co BIGTIFF=YES "
                "--optfile images.txt -overwrite partial.tif; }"
            ),
            f"{{ [ -f {warped} ] || mv partial.tif {warped}; }}",
            *(
                "{ "
                + " || ".join([f"{tile} --min-zoom {z} --max-zoom {z}"] * 3)
                + "; }"
                for z in range(maxzoom, minzoom - 1, -1)
            ),
            f"rm {warped}",
        ]
    )


def pack(tiles: Path, out: Path, code: str) -> Path:
    """tiles/z/x/y.webp into an MBTiles file (for pmtiles convert), with the
    bounds of what's there."""
    zooms = sorted(int(z.name) for z in tiles.iterdir() if z.name.isdigit())
    top = zooms[-1]
    xs = [int(x.name) for x in (tiles / str(top)).iterdir()]
    ys = [int(y.stem) for x in (tiles / str(top)).iterdir() for y in x.iterdir()]
    west, _, _, north = tile_bounds(min(xs), min(ys), top)
    _, south, east, _ = tile_bounds(max(xs), max(ys), top)
    writer = MBTiles(
        out,
        f"IGN BD ORTHO, {DEPARTEMENTS[code][0]}",
        "webp",
        zooms[0],
        top,
        SOURCES["fr_ign"].credit,
        (west, south, east, north),
    )
    for path in tiles.rglob("*.webp"):
        z, x = int(path.parent.parent.name), int(path.parent.name)
        writer.put(z, x, int(path.stem), path.read_bytes())
    writer.close()
    return out


def make_tiles(
    images: list[Path], work: Path, maxzoom: int, image: str, code: str
) -> Path:
    """The département's tiles, in work/tiles.mbtiles."""
    # One image per line, as gdalwarp's --optfile reads them (no command too long).
    (work / "images.txt").write_text(
        "".join(f"{p.relative_to(work)}\n" for p in images)
    )
    tiles = work / f"tiles-z{maxzoom}"
    docker_run(image, work, ["sh", "-c", pipeline(maxzoom)], {"GDAL_CACHEMAX": "4096"})
    mbtiles = pack(tiles, work / "tiles.mbtiles", code)
    shutil.rmtree(tiles)
    return mbtiles


# --- The command --------------------------------------------------------------------------


def have_zoom(path: Path) -> int | None:
    """The last zoom of a département's file, None if it isn't there."""
    header = read_header(path)
    return header.maxzoom if header else None


def command_bdortho(args) -> None:
    """Download and convert départements one after the other (bdortho --dept 67
    68), one download at a time (the offline maps' lock)."""
    folder = Path(args.basemap_dir).resolve()
    count = len(args.dept)
    what = f"IGN {count} département{'s' if count > 1 else ''} to zoom {args.maxzoom}"
    try:
        with inventory.lock(folder, what):
            for n, code in enumerate(args.dept, 1):
                one_departement(args, folder, code, f"[{n}/{count}]")
    except inventory.Busy as busy:
        sys.exit(f"Another download is running: {busy}.")


def one_departement(args, folder: Path, code: str, counter: str) -> None:
    name = DEPARTEMENTS[code][0]
    out = file_of(folder, code)
    have = have_zoom(out)
    label = f"{counter} {name} ({code})"
    if have is not None and have >= args.maxzoom:
        print(f"{label}: already there to zoom {have}.", file=sys.stderr)
        return
    # A speed cap for IGN's download service (MB/s), all parts together.
    limit = netsafe.RateLimit(args.max_rate * 1e6) if args.max_rate else None
    # Kept between runs: a stopped download goes on from there.
    work = work_of(folder, code)
    work.mkdir(exist_ok=True)
    (work / "stopped").unlink(missing_ok=True)
    try:
        images_dir = work / "images"
        images = sorted(images_dir.rglob("*.jp2")) if images_dir.exists() else []
        if not images:
            print(f"{label}: looking for IGN's latest photos...", file=sys.stderr)
            resource = latest_edition(code)
            (work / "edition").write_text(EDITION.match(resource)[4] + "\n")
            print(f"{label}: downloading {resource}", file=sys.stderr)
            first = download_archive(resource, work, limit)
            print(f"{label}: extracting...", file=sys.stderr)
            images = extract(first, images_dir, args.gdal_image)
        print(
            f"{label}: making the tiles to zoom {args.maxzoom} ({len(images)} images)...",
            file=sys.stderr,
        )
        (work / "tiles.mbtiles").unlink(missing_ok=True)
        mbtiles = make_tiles(images, work, args.maxzoom, args.tiler_image, code)
        to_pmtiles(mbtiles, out, args.pmtiles_image)
    except BaseException as stopped:
        # Why, for the offline maps menu (Resume).
        (work / "stopped").write_text(stop_reason(stopped) + "\n")
        raise
    edition = (
        (work / "edition").read_text().strip() if (work / "edition").exists() else ""
    )
    shutil.rmtree(work)
    inventory.record(folder, out.name, edition=edition)
    print(f"{label}: done -> {out.name}", file=sys.stderr)


def stop_reason(stopped: BaseException) -> str:
    if isinstance(stopped, netsafe.ServerStopped):
        return "server blocked"
    if isinstance(stopped, netsafe.ConnectionLost):
        return "no connection"
    if isinstance(stopped, KeyboardInterrupt):
        return "interrupted"
    if isinstance(stopped, OSError) and stopped.errno == 28:
        return "disk full"
    return "failed"
