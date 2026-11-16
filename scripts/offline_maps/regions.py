"""Fork: offline maps. Geofabrik's index of regions (data/osm/geofabrik-index-v1.json):
their names, which is inside which, their outlines."""

from __future__ import annotations

import json
from pathlib import Path


class Index:
    """Geofabrik's index of regions: names, parents and outlines."""

    def __init__(self, path: str | None):
        self.features: dict[str, dict] = {}
        if path and Path(path).exists():
            for f in json.loads(Path(path).read_text())["features"]:
                self.features[f["properties"]["id"]] = f

    def name(self, region: str) -> str:
        if region == "world":
            return "the whole world"
        return self.features.get(region, {}).get("properties", {}).get("name", region)

    def within(self, region: str, parent: str) -> bool:
        while region:
            if region == parent:
                return True
            region = self.features.get(region, {}).get("properties", {}).get("parent")
        return False

    def outline(self, region: str, folder: Path) -> Path | None:
        """The region's outline as a file in `folder` (written from the index)."""
        path = folder / f".area-{region}.geojson"
        if not path.exists():
            geometry = self.features.get(region, {}).get("geometry")
            if not geometry:
                return None
            path.write_text(json.dumps(geometry))
        return path

    def search(self, text: str) -> list[tuple[str, str, str]]:
        """(id, name, parent's name) of the regions matching a name, best first."""
        text = text.lower().strip()
        hits = [
            f["properties"]
            for f in self.features.values()
            if f.get("geometry")
            and (
                text in f["properties"]["id"].lower()
                or text in f["properties"]["name"].lower()
            )
        ]
        hits.sort(key=lambda r: (r["name"].lower() != text, r["name"]))
        return [
            (
                r["id"],
                r["name"],
                self.name(r.get("parent", "")) if r.get("parent") else "",
            )
            for r in hits[:15]
        ]
