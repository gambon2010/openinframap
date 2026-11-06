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

from .departements import DEPARTEMENTS
from .gdal import docker_run, pmtiles_zooms, to_pmtiles
from .sources import EARTH_CIRCUMFERENCE_M, TIERS, USER_AGENT

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
# WebP quality of the tiles: smaller than IGN's JPEG, still sharp.
QUALITY = 75
# Sizes, measured on Bas-Rhin (2024): the archive per km², a WebP tile.
ARCHIVE_BYTES_PER_KM2 = 4_800_000
WEBP_TILE_BYTES = 12_000

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


def tiles_of(code: str, maxzoom: int, minzoom: int = TIERS["detailed"][0]) -> int:
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


# --- IGN's download service -----------------------------------------------------------


def atom(url: str) -> ET.Element:
    data = netsafe.fetch(url, user_agent=USER_AGENT)
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
            parts.append((href, int(link.get("length") or 0)))
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
    text = (netsafe.fetch(md5_url, user_agent=USER_AGENT) or b"").decode()
    sums = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) == 2:
            sums[Path(parts[1]).name] = parts[0]
    return sums


def download_archive(resource: str, work: Path) -> Path:
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
            netsafe.fetch_file(url, path, user_agent=USER_AGENT, progress=progress)
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


def pipeline(maxzoom: int, minzoom: int = TIERS["detailed"][0]) -> str:
    """The GDAL commands (run in `work`, the images listed in images.txt) that make
    the département's tiles: mosaic, reproject at the zoom's resolution (GDAL reads
    each JPEG 2000 at the reduced resolution it needs: quick below 20 cm), WebP
    tiles with transparency outside the photos, then the lower zooms."""
    resolution = EARTH_CIRCUMFERENCE_M / 256 / 2**maxzoom
    levels = " ".join(str(2**i) for i in range(1, maxzoom - minzoom + 1))
    return " && ".join(
        [
            "gdalbuildvrt -q -input_file_list images.txt src.vrt",
            (
                f"gdalwarp -q -of VRT -t_srs EPSG:3857 -tr {resolution} {resolution} "
                "-r bilinear -dstalpha -overwrite src.vrt warped.vrt"
            ),
            (
                "gdal_translate -q -of MBTILES -co TILE_FORMAT=WEBP "
                f"-co QUALITY={QUALITY} -co ZOOM_LEVEL_STRATEGY=LOWER "
                "warped.vrt tiles.mbtiles"
            ),
        ]
        + ([f"gdaladdo -q -r average tiles.mbtiles {levels}"] if levels else [])
    )


def make_tiles(images: list[Path], work: Path, maxzoom: int, gdal_image: str) -> Path:
    (work / "images.txt").write_text(
        "".join(f"/w/{p.relative_to(work)}\n" for p in images)
    )
    docker_run(
        gdal_image,
        work,
        ["sh", "-c", pipeline(maxzoom)],
        {
            "GDAL_NUM_THREADS": "ALL_CPUS",
            "GDAL_CACHEMAX": "2048",
        },
    )
    return work / "tiles.mbtiles"


# --- The command --------------------------------------------------------------------------


def have_zoom(path: Path) -> int | None:
    """The last zoom of a département's file, None if it isn't there."""
    zooms = pmtiles_zooms(path)
    return zooms[1] if zooms else None


def command_bdortho(args) -> None:
    """Download and convert départements one after the other (bdortho --dept 67 68)."""
    folder = Path(args.basemap_dir).resolve()
    for n, code in enumerate(args.dept, 1):
        name = DEPARTEMENTS[code][0]
        out = file_of(folder, code)
        have = have_zoom(out)
        label = f"[{n}/{len(args.dept)}] {name} ({code})"
        if have is not None and have >= args.maxzoom:
            print(f"{label}: already there to zoom {have}.", file=sys.stderr)
            continue
        print(f"{label}: looking for IGN's latest photos...", file=sys.stderr)
        resource = latest_edition(code)
        # Kept between runs: a stopped download goes on from there.
        work = folder / f".bdortho-{code}"
        work.mkdir(exist_ok=True)
        images_dir = work / "images"
        images = sorted(images_dir.rglob("*.jp2")) if images_dir.exists() else []
        if not images:
            print(f"{label}: downloading {resource}", file=sys.stderr)
            first = download_archive(resource, work)
            print(f"{label}: extracting...", file=sys.stderr)
            images = extract(first, images_dir, args.gdal_image)
        print(
            f"{label}: making the tiles to zoom {args.maxzoom} ({len(images)} images)...",
            file=sys.stderr,
        )
        (work / "tiles.mbtiles").unlink(missing_ok=True)
        mbtiles = make_tiles(images, work, args.maxzoom, args.gdal_image)
        to_pmtiles(mbtiles, out, args.pmtiles_image)
        shutil.rmtree(work)
        print(f"{label}: done -> {out.name}", file=sys.stderr)
