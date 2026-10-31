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

-- Situations: named moments ("Morning brief 30 Oct 08:00"). The layers as they were
-- after change change_id, rebuilt from the history when viewed (nothing copied).
CREATE TABLE IF NOT EXISTS userdata.situation (
    id bigserial PRIMARY KEY,
    name text NOT NULL,
    change_id bigint NOT NULL,
    author text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Statuses of map features (docs/plans/feature-status.md): about the real
-- features of the map, shared by everyone, separate from My layers. A feature is
-- its table and id (status.py SOURCE_TABLES, as several tile layers show the same
-- table); its geometry is copied so it's drawn whatever the tiles, and kept
-- across rebuilds like the rest of userdata.
CREATE TABLE IF NOT EXISTS userdata.feature_status (
    source text NOT NULL,
    feature_id bigint NOT NULL,
    layer text NOT NULL,
    status text NOT NULL,
    evidence text,
    note text,
    details jsonb NOT NULL DEFAULT '{}',
    name text,
    author text,
    geometry geometry(Geometry, 4326),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source, feature_id)
);

-- Every status change, in order: the status history.
CREATE TABLE IF NOT EXISTS userdata.status_change (
    id bigserial PRIMARY KEY,
    source text NOT NULL,
    feature_id bigint NOT NULL,
    status text NOT NULL,
    previous text,
    evidence text,
    note text,
    details jsonb NOT NULL DEFAULT '{}',
    author text,
    made_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS status_change_feature ON userdata.status_change (source, feature_id, id);

-- Towers' numbers along their lines (tower_numbers.py), kept so a tower keeps its
-- number at every renumbering: a line is matched to the one it was by the towers
-- they share, a tower already numbered keeps its number ("23"), one added between
-- two gets a letter ("23a"), past the end the next numbers; a number is never
-- given again. Kept with userdata across rebuilds and in exports.
CREATE TABLE IF NOT EXISTS userdata.tower_line_ref (
    line_key bigserial PRIMARY KEY,
    voltage integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS userdata.tower_ref (
    osm_id bigint NOT NULL,
    line_key bigint NOT NULL,
    label text NOT NULL,
    PRIMARY KEY (line_key, osm_id)
);
CREATE INDEX IF NOT EXISTS tower_ref_osm_id ON userdata.tower_ref (osm_id)
