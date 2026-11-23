# shellcheck shell=bash
# Small JSON files the scripts keep next to what they describe (an export's
# manifest, a background map's, saved extra data's): read one field, write one.
# Sourced by common.sh.

# json_get FILE KEY — one field ("" if it isn't there).
json_get() {
    python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get(sys.argv[2], ""))' "$1" "$2"
}

# json_write FILE key=value ... — write FILE with these fields: text values, or
# numbers with key:=123.
json_write() {
    python3 -c 'import json, sys
fields = {}
for arg in sys.argv[2:]:
    key, sep, value = arg.partition("=")
    if key.endswith(":"):
        fields[key[:-1]] = json.loads(value)
    else:
        fields[key] = value
json.dump(fields, open(sys.argv[1], "w"), indent=2)' "$@"
}
