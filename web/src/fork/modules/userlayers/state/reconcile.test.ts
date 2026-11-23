import { describe, expect, it } from 'vitest'
import { Change, UserFeature, UserLayer } from '../model/model.ts'
import { applyChange, cloneLayers } from './changes.ts'
import { Bases, baseOf, featureKey, reconcile } from './reconcile.ts'

const feature = (id: string, name: string, coords = [7, 48], version = 1) =>
  ({
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: coords },
    properties: { kind: 'symbol', name },
    version
  }) as UserFeature

function layers(features: UserFeature[], version = 1): Map<string, UserLayer> {
  return new Map([
    ['L', { id: 'L', name: 'Units', style: {}, features: new Map(features.map((f) => [f.id, f])), version }]
  ])
}

/** Your side: the saved layers, your changes on top, and their bases. */
function yours(saved: Map<string, UserLayer>, pending: Change[]) {
  const bases: Bases = {}
  const current = cloneLayers(saved)
  for (const c of pending) {
    const key = c.op.startsWith('layer_') ? `layer:${c.layer_id}` : featureKey(c.feature_id!)
    bases[key] ??= baseOf(saved, key)
    applyChange(current, c)
  }
  return { bases, current }
}

const at = '2026-11-01T10:00:00Z'
const update = (f: UserFeature): Change => ({
  op: 'feature_update',
  layer_id: 'L',
  feature_id: f.id,
  data: { geometry: f.geometry, properties: f.properties },
  made_at: at
})

describe('reconcile', () => {
  const saved = layers([feature('f', 'Alpha')])

  it('you moved it, they renamed it: both, and the bases move on', () => {
    const pending = [update(feature('f', 'Alpha', [8, 49]))]
    const { bases, current } = yours(saved, pending)
    const fresh = layers([feature('f', 'Bravo', [7, 48], 2)])
    const out = reconcile(bases, pending, current, fresh)
    expect(out.conflicts).toEqual([])
    expect(out.pending).toHaveLength(1)
    expect(out.pending[0].data?.properties?.name).toBe('Bravo')
    expect(out.pending[0].data?.geometry).toEqual({ type: 'Point', coordinates: [8, 49] })
    expect(out.bases['feature:f'].version).toBe(2)
  })

  it('both renamed it differently: a conflict, yours kept for now', () => {
    const pending = [update(feature('f', 'Charlie'))]
    const { bases, current } = yours(saved, pending)
    const fresh = layers([feature('f', 'Bravo', [7, 48], 2)])
    const out = reconcile(bases, pending, current, fresh)
    expect(out.conflicts.map((c) => [c.key, c.fields])).toEqual([['feature:f', ['properties.name']]])
    expect(out.pending[0].data?.properties?.name).toBe('Charlie')
  })

  it('what they changed and you did not touch needs no change of yours', () => {
    const pending = [update(feature('f', 'Bravo'))] // you made it Bravo, so did they
    const { bases, current } = yours(saved, pending)
    const out = reconcile(bases, pending, current, layers([feature('f', 'Bravo', [7, 48], 2)]))
    expect(out).toMatchObject({ pending: [], conflicts: [] })
  })

  it('you deleted it, they changed it: a conflict', () => {
    const pending: Change[] = [{ op: 'feature_delete', layer_id: 'L', feature_id: 'f', made_at: at }]
    const { bases, current } = yours(saved, pending)
    const out = reconcile(bases, pending, current, layers([feature('f', 'Bravo', [7, 48], 2)]))
    expect(out.conflicts[0].fields).toEqual(['deleted'])
    expect(out.pending.map((c) => c.op)).toEqual(['feature_delete'])
  })

  it('a new item of yours stays; one in a layer they deleted is left out', () => {
    const g = feature('g', 'New')
    const pending: Change[] = [
      {
        op: 'feature_create',
        layer_id: 'L',
        feature_id: 'g',
        data: { geometry: g.geometry, properties: g.properties },
        made_at: at
      }
    ]
    const { bases, current } = yours(saved, pending)
    expect(
      reconcile(bases, pending, current, layers([feature('f', 'Alpha')])).pending.map((c) => c.op)
    ).toEqual(['feature_create'])
    expect(reconcile(bases, pending, current, new Map()).pending).toEqual([])
  })
})
