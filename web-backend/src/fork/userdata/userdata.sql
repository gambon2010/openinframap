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
CREATE INDEX IF NOT EXISTS tower_ref_osm_id ON userdata.tower_ref (osm_id);

-- Accounts (docs/plans/sync.md, "Login for the whole app"): local only, made by
-- admins (the first one at setup). Passwords hashed with scrypt (auth/passwords.py).
CREATE TABLE IF NOT EXISTS userdata.app_user (
    id serial PRIMARY KEY,
    name text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    is_admin boolean NOT NULL DEFAULT false,
    disabled boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Who is logged in: a random token in a cookie, stored hashed (sha256).
CREATE TABLE IF NOT EXISTS userdata.user_session (
    token_hash text PRIMARY KEY,
    user_id integer NOT NULL REFERENCES userdata.app_user (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

-- Owners and sharing (docs/plans/sync.md, phase 2). A layer belongs to who made it;
-- layers made before there were accounts have no owner: open to everyone, admins
-- act as their owner (access.py). The owner shares a layer per account, to view or
-- to modify.
ALTER TABLE userdata.layer ADD COLUMN IF NOT EXISTS owner_id integer
    REFERENCES userdata.app_user (id) ON DELETE SET NULL;
ALTER TABLE userdata.save ADD COLUMN IF NOT EXISTS user_id integer
    REFERENCES userdata.app_user (id) ON DELETE SET NULL;
-- The layers a situation covers (null: from before; seen by everyone).
ALTER TABLE userdata.situation ADD COLUMN IF NOT EXISTS layer_ids uuid[];
CREATE TABLE IF NOT EXISTS userdata.layer_access (
    layer_id uuid NOT NULL REFERENCES userdata.layer (id),
    user_id integer NOT NULL REFERENCES userdata.app_user (id) ON DELETE CASCADE,
    level text NOT NULL CHECK (level IN ('view', 'modify')),
    PRIMARY KEY (layer_id, user_id)
);

-- Versions (docs/plans/sync.md, phase 3): raised by every saved change to a layer or
-- an item; Save says the version each change started from and is refused if the
-- server's has moved on since (someone else saved it meanwhile). And who saved last.
ALTER TABLE userdata.layer ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE userdata.layer ADD COLUMN IF NOT EXISTS updated_by text;
ALTER TABLE userdata.feature ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE userdata.feature ADD COLUMN IF NOT EXISTS updated_by text;

-- Personal settings (docs/plans/sync.md, phase 5), one JSON value per account and
-- key: My layers' "userlayers" (each layer's folder, the layers hidden, open and
-- folded in the list, empty folders), so they follow the account to any computer.
CREATE TABLE IF NOT EXISTS userdata.user_setting (
    user_id integer NOT NULL REFERENCES userdata.app_user (id) ON DELETE CASCADE,
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, key)
)
