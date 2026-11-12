"""Fork: satellite imagery. Docker helpers: GDAL for the Sentinel-2 composite, pmtiles for the final files."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from .sources import EARTH_CIRCUMFERENCE_M, SENTINEL2

# --- Docker helpers -------------------------------------------------------------


def docker_run(
    image: str, workdir: Path, args: list[str], env: dict[str, str] | None = None
) -> None:
    command = [
        "docker",
        "run",
        "--rm",
        "--user",
        f"{os.getuid()}:{os.getgid()}",
        "-v",
        f"{workdir}:/w:z",
        "-w",
        "/w",
    ]
    for key, value in (env or {}).items():
        command += ["-e", f"{key}={value}"]
    subprocess.run(command + [image] + args, check=True, stdin=subprocess.DEVNULL)


def pmtiles_zooms(path: Path) -> tuple[int, int] | None:
    """A PMTiles file's lowest and highest zoom (from its header), None if unreadable."""
    try:
        header = path.open("rb").read(127)
    except OSError:
        return None
    return (header[100], header[101]) if header[:7] == b"PMTiles" else None


def to_pmtiles(mbtiles: Path, out: Path, pmtiles_image: str) -> None:
    """MBTiles -> PMTiles, with the basemap service's pmtiles CLI."""
    workdir = mbtiles.parent
    docker_run(
        pmtiles_image, workdir, ["convert", f"/w/{mbtiles.name}", f"/w/{out.name}.tmp"]
    )
    (workdir / f"{out.name}.tmp").replace(out)


def regional_pipeline(maxzoom: int, cut: bool = True) -> str:
    """The GDAL commands (run in the GDAL image) that turn the composite cells
    (listed in cells.txt) into web tiles: mosaic, reproject and cut to the outline
    (or the whole world), scale the 16-bit reflectance to 8-bit (one fixed curve
    for every cell, so tiles match), tile, add lower zooms."""
    resolution = EARTH_CIRCUMFERENCE_M / 256 / 2**maxzoom
    # Many cells (the world): their list in a file, not on the command line.
    sources = "-input_file_list cells.txt"
    levels = " ".join(str(2**i) for i in range(1, maxzoom - SENTINEL2.first_zoom + 1))
    scale = " ".join(f"-scale_{b} 0 2200 0 255 -exponent_{b} 0.7" for b in (1, 2, 3))
    return " && ".join(
        [
            f"gdalbuildvrt -q src.vrt {sources}",
            (
                f"gdalwarp -q -of VRT -t_srs EPSG:3857 -tr {resolution} {resolution} -r bilinear "
                + (
                    "-cutline area.geojson -crop_to_cutline "
                    if cut
                    else "-te -20037508.34 -20037508.34 20037508.34 20037508.34 "
                )
                + "-dstalpha -overwrite src.vrt warped.vrt"
            ),
            (
                f"gdal_translate -q -of MBTILES -b 1 -b 2 -b 3 -b 5 -ot Byte {scale} -scale_4 0 65535 0 255 "
                "-co TILE_FORMAT=WEBP -co QUALITY=75 -co ZOOM_LEVEL_STRATEGY=LOWER warped.vrt regional.mbtiles"
            ),
        ]
        + ([f"gdaladdo -q -r average regional.mbtiles {levels}"] if levels else [])
    )
