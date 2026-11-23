"""tegola/layers.fork.yml: what Tegola refuses to start with (and with it, every map's
tiles): a layer listing its id among its fields (generate_tegola_config.py then
leaves out the id column Tegola needs; indoor_building did, 2026-11-23)."""

from pathlib import Path

import yaml

LAYERS = Path(__file__).resolve().parents[2] / "tegola" / "layers.fork.yml"


def test_no_layer_lists_its_id_among_its_fields():
    layers = yaml.safe_load(LAYERS.read_text())["layers"]
    listed = [
        layer["name"]
        for layer in layers
        if layer.get("id_field") in {field["name"] for field in layer.get("fields", [])}
    ]
    assert listed == []
