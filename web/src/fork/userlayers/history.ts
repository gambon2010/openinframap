// Fork: playing back the history of "My layers": every saved change, in order,
// from the backend's log (userdata.change). Step k shows the layers as they were
// after the first k changes.
import { tt } from './i18n.ts'
import { Map, LngLatBounds } from 'maplibre-gl'
import { Change, SavedChange, UserFeature, UserLayer } from './model.ts'
import { applyChange } from './store.ts'
import { loadHistory } from './api.ts'
import { symbolName } from './palette.ts'
import { FIELDS } from './fields.ts'
import { ECHELONS, IDENTITIES, STATUSES } from './sidc.ts'

function asChange(saved: SavedChange): Change {
  const after = saved.after
  const change: Change = {
    op: saved.op,
    layer_id: saved.layer_id,
    feature_id: saved.feature_id ?? undefined,
    made_at: saved.made_at
  }
  if (after && saved.op.startsWith('layer_')) change.data = { name: after.name, style: after.style }
  if (after && saved.op.startsWith('feature_'))
    change.data = { geometry: after.geometry, properties: after.properties }
  return change
}

function featureLabel(feature: Partial<UserFeature> | undefined): string {
  const p = feature?.properties
  if (!p) return tt('userlayers.feature', 'a feature')
  const label = p.modifiers?.['T'] || p.name
  const name = label ? ` "${label}"` : ''
  switch (p.kind) {
    case 'symbol':
      return `${tt('userlayers.kind.symbol', 'symbol')}${name || ` (${symbolName(p.sidc ?? '') ?? p.sidc})`}`
    case 'graphic':
      return `${tt('userlayers.kind.graphic', 'graphic')}${name || ` (${symbolName(p.sidc ?? '') ?? p.sidc})`}`
    case 'image':
      return `${tt('userlayers.kind.image', 'picture')}${name}`
    case 'marker':
      return `${tt('userlayers.kind.marker', 'marker')}${name}`
    case 'copy':
      return `${tt('userlayers.kind.copy', 'copy of')} ${p.copy?.layer ?? ''}${name}`
    default:
      return `${feature?.geometry?.type === 'Polygon' ? tt('userlayers.kind.area', 'area') : tt('userlayers.kind.line', 'line')}${name}`
  }
}

const label = (list: [string, string][], code: string) => list.find(([c]) => c === code)?.[1] ?? code

/**
 * What changed between two versions of a feature, in words ("status: Planned →
 * Present", "higher formation", "moved"). Empty if nothing that's shown changed.
 */
export function changedFields(
  before: Partial<UserFeature> | undefined,
  after: Partial<UserFeature>
): string[] {
  const a = before?.properties ?? ({} as UserFeature['properties'])
  const b = after.properties ?? ({} as UserFeature['properties'])
  const out: string[] = []
  if (a.sidc && b.sidc && a.sidc !== b.sidc) {
    if (a.sidc[1] !== b.sidc[1])
      out.push(
        `${tt('userlayers.f.identity', 'identity')}: ${label(IDENTITIES, a.sidc[1])} → ${label(IDENTITIES, b.sidc[1])}`
      )
    if (a.sidc[3] !== b.sidc[3])
      out.push(
        `${tt('userlayers.f.status', 'status')}: ${label(STATUSES, a.sidc[3])} → ${label(STATUSES, b.sidc[3])}`
      )
    if (a.sidc[11] !== b.sidc[11] && b.sidc[0] === 'S')
      out.push(
        `${tt('userlayers.f.echelon', 'echelon')}: ${label(ECHELONS, a.sidc[11])} → ${label(ECHELONS, b.sidc[11])}`
      )
    if (a.sidc.slice(4, 10) !== b.sidc.slice(4, 10)) out.push(tt('userlayers.f.symbol', 'symbol'))
  }
  const keys = new Set([...Object.keys(a.modifiers ?? {}), ...Object.keys(b.modifiers ?? {})])
  for (const key of keys) {
    if ((a.modifiers?.[key] ?? '') !== (b.modifiers?.[key] ?? '')) {
      const field = FIELDS.find((f) => f.key === key)
      out.push(tt(`userlayers.f.${key}`, field?.label ?? key).toLowerCase())
    }
  }
  for (const [key, text] of [
    ['name', 'name'],
    ['notes', 'notes'],
    ['color', 'colour'],
    ['size', 'size'],
    ['width', 'line width']
  ] as const) {
    if (a[key] !== b[key]) out.push(tt(`userlayers.changed.${key}`, text))
  }
  if (
    before?.geometry &&
    after.geometry &&
    JSON.stringify(before.geometry) !== JSON.stringify(after.geometry)
  )
    out.push(tt('userlayers.changed.moved', 'moved'))
  return [...new Set(out)]
}

export class Playback {
  changes: SavedChange[] = []
  position = 0
  private map: Map
  private timer: number | undefined

  constructor(map: Map) {
    this.map = map
  }

  async load() {
    this.changes = await loadHistory()
    this.position = this.changes.length
  }

  /** The layers after the first `position` changes. */
  snapshot(): globalThis.Map<string, UserLayer> {
    const layers = new globalThis.Map<string, UserLayer>()
    for (const saved of this.changes.slice(0, this.position)) applyChange(layers, asChange(saved))
    return layers
  }

  /** The change shown at this step (the last one applied). */
  current(): SavedChange | undefined {
    return this.changes[this.position - 1]
  }

  /** What the current step did, in words. */
  describe(layers: globalThis.Map<string, UserLayer>): string {
    const change = this.current()
    if (!change) return tt('userlayers.history.start', 'Before the first change')
    const when = new Date(change.made_at).toLocaleString()
    const who = change.author ? ` · ${change.author}` : ''
    const layerName = change.after?.name ?? layers.get(change.layer_id)?.name ?? ''
    const previous = this.changes
      .slice(0, this.position - 1)
      .reverse()
      .find((c) => c.feature_id && c.feature_id === change.feature_id && c.after)
    let what
    switch (change.op) {
      case 'layer_create':
        what = tt('userlayers.history.layer-create', 'Made the layer "{{name}}"', { name: layerName })
        break
      case 'layer_update':
        what = tt('userlayers.history.layer-update', 'Changed the layer "{{name}}"', { name: layerName })
        break
      case 'layer_delete': {
        // The layer is gone from the snapshot: its name from before.
        const name = this.changes
          .slice(0, this.position - 1)
          .reverse()
          .find((c) => c.layer_id === change.layer_id && c.after?.name)?.after?.name
        what = name
          ? tt('userlayers.history.layer-delete-named', 'Deleted the layer "{{name}}"', { name })
          : tt('userlayers.history.layer-delete', 'Deleted a layer')
        break
      }
      case 'feature_create':
        what = tt('userlayers.history.feature-create', 'Added {{what}} to "{{layer}}"', {
          what: featureLabel(change.after),
          layer: layers.get(change.layer_id)?.name ?? ''
        })
        break
      case 'feature_update': {
        what = tt('userlayers.history.feature-update', 'Changed {{what}}', {
          what: featureLabel(change.after)
        })
        const fields = changedFields(previous?.after, change.after ?? {})
        if (fields.length) what += `: ${fields.join(', ')}`
        break
      }
      default:
        what = tt('userlayers.history.feature-delete', 'Deleted {{what}}', {
          what: featureLabel(previous?.after)
        })
    }
    return `${this.position}/${this.changes.length} · ${when}${who}: ${what}`
  }

  /** The feature the current step is about (for highlighting it). */
  feature(): UserFeature | null {
    const change = this.current()
    if (!change?.feature_id) return null
    if (change.after) return change.after as UserFeature
    const previous = this.changes
      .slice(0, this.position - 1)
      .reverse()
      .find((c) => c.feature_id === change.feature_id && c.after)
    return (previous?.after as UserFeature) ?? null
  }

  /** Bring the current step's feature into view, if it isn't. */
  follow() {
    const feature = this.feature()
    if (!feature) return
    const bounds = new LngLatBounds()
    const add = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === 'number') bounds.extend(c as [number, number])
      else if (Array.isArray(c)) c.forEach(add)
    }
    add((feature.geometry as GeoJSON.Point).coordinates)
    if (bounds.isEmpty()) return
    const view = this.map.getBounds()
    if (!view.contains(bounds.getNorthEast()) || !view.contains(bounds.getSouthWest())) {
      this.map.fitBounds(bounds, { padding: 80, maxZoom: Math.max(this.map.getZoom(), 12) })
    }
  }

  /** Steps per second (the timeline's speed). */
  speed = 1

  play(step: () => void) {
    this.stop()
    if (this.position >= this.changes.length) this.position = 0
    this.timer = window.setInterval(() => {
      if (this.position >= this.changes.length) {
        this.stop()
        step()
        return
      }
      this.position++
      step()
    }, 900 / this.speed)
  }

  stop() {
    if (this.timer !== undefined) window.clearInterval(this.timer)
    this.timer = undefined
  }

  get playing() {
    return this.timer !== undefined
  }
}
