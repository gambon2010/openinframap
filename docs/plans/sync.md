# Plan: users, shared layers and live sync for My layers

Status: **agreed in discussion (2026-10-30)**. Nothing is built yet; it builds on the refactor
(`docs/plans/refactor.md`, phases 3 and 4). Backlog items 10.6 and 10.6b in
`docs/SPECIFICATIONS.md`.

## What it does

- **People log in.** Every layer belongs to the user who made it (its owner).
- **The owner shares a layer**, per user, to **view** or to **modify**. Only the
  owner can share it, rename the owner's lock, or delete the layer.
- **Layers update by themselves.** When someone saves a change to a layer you can
  see, your map shows it within a second or two, with no reload.
- **Your own edits** are still only sent when you click **Save**, as now.
- **When the server and you changed the same thing**, a window lets you choose,
  item by item, which version to keep.

## Merging what arrives with what you're doing

Each item (and each layer) has a **version number** on the server, raised on
every saved change. The app remembers, for each item, the version its copy
started from (the "base"). When a newer version arrives, it's merged **field by
field**:
- the position (geometry);
- each property: name, notes, colour, size;
- the code's parts (identity, status, echelon);
- each detail (modifier).

| You changed the field? | They changed it? | Result |
|---|---|---|
| no | yes | theirs is taken, silently |
| yes | no | yours stays (sent with your next Save) |
| yes, to the same value | yes | nothing to do |
| yes | yes, differently | **conflict** |

So if you only moved a unit and someone else renamed it, you get both, with no
window. The same rule as undo after Save (`revertFields`).

Deleting counts as changing every field:
- they deleted an item you edited, or you deleted one they edited → conflict
  ("keep mine" brings it back, "take theirs" deletes it);
- both deleted it → nothing to do.

**Save checks the versions.** Save sends each change with its base version. If an
item changed on the server since then, the server refuses the whole Save (all or
nothing, as now) and says which items. The app fetches them, merges them as above,
and you save again. So two people saving a second apart never silently overwrite
each other.

**Undo** only takes back your own changes: what arrived from others isn't in
your undo history, and undoing puts back only the fields your change touched.

## The conflict window

- **One conflict at a time:**
  - which item and layer, who changed it, and when;
  - your version and theirs side by side, with the differing fields marked;
  - **Keep mine** / **Take theirs**.
- **Moving between conflicts:** **Next** and **Back** go through the list without
  resolving, and a counter shows "2 of 5". **Keep all mine** and **Take all
  theirs** are for many at once.
- **Minimising:** the window folds to a small bar ("3 conflicts: resolve") and
  you keep working. Until a conflict is resolved, the map shows **your** version
  of that item, marked as in conflict on the map and in the list.
- **Blocked saving:** **Save** is disabled while a conflict is unresolved, and its
  tooltip says why.
- **Resolving:** choosing "Keep mine" makes your version an ordinary unsaved
  change (sent with the next Save, against the server's new version).

## Losing access, deleted layers

If the owner deletes a layer, or takes away your access, while you have unsaved
changes in it, nothing can be saved there anymore. A notice offers to copy your
unsaved items into a new layer of your own, so the work isn't lost. A layer you
can only view never has unsaved changes: it's read-only, like a locked layer
today.

**Moving an item** to another layer needs modify access to both layers.

## Shared or personal

- **Shared (stored on the layer):** name, colour, the owner's lock ("nobody edits
  this right now"), and the items.
- **Personal (stored per user):**
  - folder;
  - shown or hidden;
  - folded in the list;
  - "draw into" layer;
  - favourite symbols.

The folder, which is on the layer today, moves to a per-user setting.

## Situations

Today a situation is a named point in the change history ("everything after
change #N") and shows every layer. With access control:
- it also records **which layers it covers**. When it's made, the default is the
  layers shown on the map; they can be ticked or unticked;
- a user sees a situation **only if they can view all of its layers**;
- viewing it shows only those layers, as they were then. A layer deleted since
  then still counts, with the access it had when deleted.

## How the app hears about changes

- **Pushing updates.** The backend pushes "change #N on layer L" over a
  connection the page keeps open (Server-Sent Events), only for layers the user
  can view.
- **Catching up.** If the connection drops (offline, backend restart), the app
  asks on reconnect for every change since the last number it saw. The change
  log is already numbered in order.

## Changes to the database (userdata schema)

- `user`: id, name, password hash (local accounts only).
- `layer`: + `owner`, + `version`.
- `feature`: + `version`.
- `layer_access`: layer, user, `view` or `modify`.
- `user_layer_settings`: user, layer, folder, hidden, folded.
- `situation`: + the list of its layers.
- `save.author` becomes a user id (keeping the name for the old saves).

**Existing layers:** they need an owner. The first user created gets all of them,
and other users get modify access to them, so nothing is lost or hidden.

## Where it goes in the code (after the refactor)

- **Frontend** (`fork/modules/userlayers/state/`):
  - `transport.ts`: Save with versions, the push connection, catching up;
  - `merge.ts`: the field-by-field merge, pure and unit-tested like `changes.ts`;
  - the conflict list lives in the store;
  - the view object answers "can I edit?" (owner lock, view-only access, past
    views).
  - The conflict window is a component in `ui/`.
- **Backend** (`src/fork/userdata/`):
  - `current_user()` (phase 4) becomes the login check;
  - `changes.py` checks versions and access;
  - a new `events.py` for the push connection;
  - login routes.

## Still open (later, not needed to start)

- Login: **local accounts only** (decided 2026-10-30).
- Who can create users: an admin, or anyone?
- Offline for a long time: the push connection catches up fine, but a very long
  offline session may end with many conflicts. Good enough for now.
