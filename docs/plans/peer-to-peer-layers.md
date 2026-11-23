# My layers between computers without a central server (plan, 2026-11-22)

Asked (spec 10.105): today a layer is shared by the users of one installation (its
backend, on the local network). Wanted: plug a layer into someone else's computer,
each with its own installation, no central server. Not started.

## What we have to build on

Each installation keeps a layer as a log of changes with versions
(`userdata.change`, `state/reconcile.ts`): a three-way merge of what you changed
against what others saved since your copy's base, conflicts shown. Exports (GeoJSON,
KML, GPX) carry the items only, not their history.

## Options looked at

- **CRDTs** ([Automerge](https://automerge.org), [Yjs](https://yjs.dev), both MIT):
  merge without a server whatever order changes arrive in, over any transport (files,
  sockets, WebRTC). The right tool for many peers editing offline, but our layers
  would move from the change log to a CRDT document: a rewrite of state/, kept for
  later if two step-ups below aren't enough.
- **WebRTC in the browser** (y-webrtc, PeerJS): needs a signalling server to meet,
  and both browsers open at once: not for computers that meet now and then.
- **Cursor on Target** (ATAK's XML messages over UDP or TCP): what military kit speaks;
  the right way to exchange positions with ATAK/WinTAK (see the battle simulation
  vision), not to sync whole layers with history.

## Proposed, in two steps

1. **Sync bundles (files).** "Export for another installation": a layer with its
   changes since a version, signed with the layer's key (made when it's first
   shared). Carried any way (USB stick, mail, a radio file transfer); imported on the
   other computer, it's merged like a save from another user (the same reconcile and
   conflict window). Each side keeps, per peer, the last version it has from it, so
   the next bundle holds only what's new. Works with no network at all. About two
   days.
2. **Linked installations.** A layer linked to a peer installation (its address and
   the layer's key, exchanged once, a QR code or a file): when both can reach each
   other (local network, a VPN or mesh like Tailscale or Yggdrasil), each backend
   pulls the other's changes since the last version it has and pushes its own,
   through the gate (HTTPS, the peer's key instead of a login). Conflicts as today.
   Nothing central: either side can be offline, they catch up when they meet. About
   three days, after step 1 (it sends the same bundles over the network).

Not planned: syncing accounts or permissions between installations (a linked layer
is shared whole, read and write, with whoever holds its key; a read-only key later
if needed).
