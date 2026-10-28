-- Fork: "My layers" (web/src/fork/userlayers/, src/fork/userdata.py): layers people
-- make on the map, with symbols, images, drawings and copies of map features.
-- layer and feature hold the current state; change is the history, every saved
-- change with its state before and after, grouped by save, so it can be played
-- back step by step. Created by the backend on first use; safe to run again.
-- Kept across rebuilds and in exports (scripts/lib/common.sh, export-db.sh).

CREATE SCHEMA IF NOT EXISTS userdata;

CREATE TABLE IF NOT EXISTS userdata.layer (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    -- Default look of drawn features: {"color": "#d32f2f", "width": 3, ...}.
    style jsonb NOT NULL DEFAULT '{}',
    deleted boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS userdata.feature (
    id uuid PRIMARY KEY,
    layer_id uuid NOT NULL REFERENCES userdata.layer (id),
    geometry geometry(Geometry, 4326) NOT NULL,
    -- What it is: {"kind": "symbol", "sidc": ...} / "image" / "drawing" / "copy", a
    -- name, and for copies of map features their original properties.
    properties jsonb NOT NULL DEFAULT '{}',
    deleted boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS feature_layer ON userdata.feature (layer_id) WHERE NOT deleted;

-- One per click of "Save".
CREATE TABLE IF NOT EXISTS userdata.save (
    id bigserial PRIMARY KEY,
    saved_at timestamptz NOT NULL DEFAULT now(),
    author text,
    note text
);

CREATE TABLE IF NOT EXISTS userdata.change (
    id bigserial PRIMARY KEY,
    save_id bigint NOT NULL REFERENCES userdata.save (id),
    op text NOT NULL CHECK (op IN ('layer_create', 'layer_update', 'layer_delete',
                                   'feature_create', 'feature_update', 'feature_delete')),
    layer_id uuid NOT NULL,
    feature_id uuid,
    -- The layer or feature as GeoJSON-ish JSON, before and after (null: didn't exist).
    before jsonb,
    after jsonb,
    -- When it was done in the browser (saved later).
    made_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS change_layer ON userdata.change (layer_id, id);

-- Pictures put on the map (resized in the browser before upload).
CREATE TABLE IF NOT EXISTS userdata.image (
    id uuid PRIMARY KEY,
    name text,
    mime text NOT NULL,
    data bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
