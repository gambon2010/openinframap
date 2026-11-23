// Fork: data layers fade in and out as their Data layers entry is ticked or unticked,
// as the roads already do (their colours change, and MapLibre animates paint, not
// visibility). While the layer switcher sets the layers' visibility, a layer shown
// starts transparent and fades to its own opacity, and a layer hidden fades out
// before it goes. Layers that change their own look (the roads') opt out.
import type { Map } from 'maplibre-gl'

export const FADE_MS = 300

/** Each layer type's opacities. */
const OPACITIES: Record<string, string[]> = {
  line: ['line-opacity'],
  fill: ['fill-opacity'],
  circle: ['circle-opacity', 'circle-stroke-opacity'],
  symbol: ['icon-opacity', 'text-opacity'],
  'fill-extrusion': ['fill-extrusion-opacity'],
  heatmap: ['heatmap-opacity'],
  raster: ['raster-opacity']
}

const ownLook: string[] = []

/** Layers whose ids start with this change their own look: not faded here. */
export function fadesOnItsOwn(prefix: string) {
  ownLook.push(prefix)
}

type PaintName = Parameters<Map['setPaintProperty']>[1]
type PaintValue = Parameters<Map['setPaintProperty']>[2]
type Visibility = 'visible' | 'none'

/** What the switcher needs (maplibregl-layer-switcher's _updateVisibility). */
interface Switcher {
  _updateVisibility(): void
}

class Fader {
  /** Layers' own opacities while they fade (by layer, by property). */
  private own = new globalThis.Map<string, Record<string, unknown>>()
  /** Layers fading out, hidden at the end. */
  private leaving = new globalThis.Map<string, number>()
  /** What the fade itself last painted (by layer, by property). */
  private painted = new globalThis.Map<string, Record<string, unknown>>()

  constructor(private map: Map) {}

  private opacities(id: string): string[] {
    const type = this.map.getLayer(id)?.type
    return type ? (OPACITIES[type] ?? []) : []
  }

  private paint(id: string, values: Record<string, unknown>, ms: number) {
    this.painted.set(id, { ...this.painted.get(id), ...values })
    for (const [property, value] of Object.entries(values)) {
      this.map.setPaintProperty(
        id,
        `${property}-transition` as PaintName,
        { duration: ms, delay: 0 } as PaintValue
      )
      this.map.setPaintProperty(id, property as PaintName, value as PaintValue)
    }
  }

  /** Its own opacities back at the end of a fade, but those another module changed
   * meanwhile (the background's look, followBackground): its change is the newer, kept
   * (bug: the sites' opacity over imagery, set while their layers faded in, was undone). */
  private paintBack(id: string, own: Record<string, unknown>, ms: number) {
    const painted = this.painted.get(id) ?? {}
    const back = Object.fromEntries(
      Object.entries(own).map(([property, value]) => {
        const now = this.map.getPaintProperty(id, property as PaintName)
        const changedMeanwhile = JSON.stringify(now) !== JSON.stringify(painted[property])
        return [property, changedMeanwhile ? now : value]
      })
    )
    this.paint(id, back, ms)
  }

  /** The layer's own opacities, read before it first fades. */
  private ownOpacities(id: string): Record<string, unknown> {
    let own = this.own.get(id)
    if (!own) {
      own = Object.fromEntries(
        this.opacities(id).map((p) => [p, this.map.getPaintProperty(id, p as PaintName)])
      )
      this.own.set(id, own)
    }
    return own
  }

  private zero(id: string): Record<string, unknown> {
    return Object.fromEntries(this.opacities(id).map((p) => [p, 0]))
  }

  /** Its visibility set, with a fade; `set` sets it at once. */
  setVisibility(id: string, visibility: Visibility, set: (v: Visibility) => void) {
    const shown = (this.map.getLayoutProperty(id, 'visibility') ?? 'visible') === 'visible'
    const leaving = this.leaving.get(id)
    if (visibility === 'visible') {
      if (leaving !== undefined) {
        // Shown again while fading out: back to its own opacity.
        window.clearTimeout(leaving)
        this.leaving.delete(id)
        this.paintBack(id, this.ownOpacities(id), FADE_MS)
        return
      }
      if (shown) return set(visibility)
      const own = this.ownOpacities(id)
      this.paint(id, this.zero(id), 0)
      set(visibility)
      requestAnimationFrame(() => {
        this.paintBack(id, own, FADE_MS)
        this.own.delete(id)
      })
      return
    }
    if (!shown || leaving !== undefined) return set(visibility)
    const own = this.ownOpacities(id)
    this.paint(id, this.zero(id), FADE_MS)
    this.leaving.set(
      id,
      window.setTimeout(() => {
        this.leaving.delete(id)
        set('none')
        // Its own opacity back while hidden, then its transitions as usual.
        this.paintBack(id, own, 0)
        for (const property of Object.keys(own))
          this.map.setPaintProperty(
            id,
            `${property}-transition` as PaintName,
            { duration: FADE_MS, delay: 0 } as PaintValue
          )
        this.own.delete(id)
      }, FADE_MS)
    )
  }
}

/** The layer switcher's entries fade their layers in and out. */
export function fadeSwitcher(map: Map, switcher: Switcher) {
  const fader = new Fader(map)
  const update = switcher._updateVisibility.bind(switcher)
  switcher._updateVisibility = () => {
    const original = map.setLayoutProperty
    const setLayout = original.bind(map)
    // While the switcher sets visibilities: through the fader.
    map.setLayoutProperty = ((id: string, property: string, value: unknown, options?: object) => {
      const own = ownLook.some((prefix) => id.startsWith(prefix))
      if (property !== 'visibility' || own || !map.getLayer(id))
        return setLayout(id, property as never, value as never, options)
      fader.setVisibility(id, value as Visibility, (v) => setLayout(id, 'visibility', v))
      return map
    }) as Map['setLayoutProperty']
    try {
      update()
    } finally {
      map.setLayoutProperty = original
    }
  }
}
