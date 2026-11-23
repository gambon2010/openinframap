"""Fork: a vector tile's layers, taken apart without decoding them.

A vector tile (Mapbox Vector Tile, protobuf) is a list of layers, each a field of
its own: field 3, "length-delimited". Reading a layer's name means reading only
its first fields, so a tile's layers can be listed, kept or dropped in a few
microseconds, without decoding any geometry. The backend drops the background
map's roads where its companion has its own (background/__init__.py); the
zoomed out build decodes only the layers it needs (zoomed_out.py).
"""

from __future__ import annotations

LAYER_FIELD = 3  # Tile.layers
NAME_FIELD = 1  # Layer.name
LENGTH_DELIMITED = 2


def _varint(data: bytes, at: int) -> tuple[int, int]:
    """The varint at `at`, and where the next field starts."""
    value = shift = 0
    while True:
        byte = data[at]
        at += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, at
        shift += 7


def _skip(data: bytes, at: int, wire_type: int) -> int:
    """Where the field after one of this wire type starts."""
    if wire_type == 0:
        return _varint(data, at)[1]
    if wire_type == 1:
        return at + 8
    if wire_type == LENGTH_DELIMITED:
        length, at = _varint(data, at)
        return at + length
    if wire_type == 5:
        return at + 4
    raise ValueError(f"Unknown protobuf wire type {wire_type}")


def _layer_name(layer: bytes) -> str:
    at = 0
    while at < len(layer):
        key, at = _varint(layer, at)
        if key >> 3 == NAME_FIELD and key & 7 == LENGTH_DELIMITED:
            length, at = _varint(layer, at)
            return layer[at : at + length].decode()
        at = _skip(layer, at, key & 7)
    return ""


def layers(tile: bytes) -> list[tuple[str, bytes]]:
    """A tile's layers, in order: (name, the layer's field as it is in the tile)."""
    found = []
    at = 0
    while at < len(tile):
        start = at
        key, at = _varint(tile, at)
        end = _skip(tile, at, key & 7)
        if key >> 3 == LAYER_FIELD and key & 7 == LENGTH_DELIMITED:
            _, body = _varint(tile, at)
            found.append((_layer_name(tile[body:end]), tile[start:end]))
        at = end
    return found


def keep(tile: bytes, names: set[str]) -> bytes:
    """The tile with only these layers."""
    return b"".join(field for name, field in layers(tile) if name in names)


def drop(tile: bytes, names: set[str]) -> bytes:
    """The tile without these layers."""
    return b"".join(field for name, field in layers(tile) if name not in names)
