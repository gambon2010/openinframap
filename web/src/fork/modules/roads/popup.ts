// Fork: what a clicked road, railway, tram or metro line says (modules/roads): its
// title only, as a person would name it ("A35 – Autoroute des Cigognes", "Tram B"),
// and the buttons other modules add (copy into My layers). Its properties are for
// debugging (the debug module lists them when on).
import type { MapGeoJSONFeature } from 'maplibre-gl'
import { t } from '../../core/i18n.ts'
import { detailsCard } from '../../ui/details.ts'
import { ROADS_PREFIX } from './layers.ts'
import { RAILWAYS_PREFIX, TRANSIT_PREFIX } from './rail-layers.ts'

type Properties = Record<string, unknown>

const text = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? String(value) : '')

/** A road's number and name: "A35 – Autoroute des Cigognes" (the number as on its
 * signs, else its reference), either alone, else its kind. */
export function roadTitle(p: Properties): string {
  const number = text(p.shield_text) || text(p.ref)
  const named = [number, text(p.name)].filter((part) => part)
  return named.length ? named.join(' – ') : t('roads.road', 'Road')
}

/** A tram or metro line by its kind and letter: "Tram B", "Metro 1". */
export function transitTitle(p: Properties): string {
  const kinds: Record<string, string> = {
    tram: t('roads.tram', 'Tram'),
    subway: t('roads.metro', 'Metro'),
    light_rail: t('roads.light-rail', 'Light rail')
  }
  const kind = kinds[text(p.kind)] ?? t('layers.trams-and-metro', 'Trams and metro')
  const ref = text(p.ref)
  if (ref) return `${kind} ${ref}`
  return text(p.name) || kind
}

/** A railway by its name, else its reference. */
export function railwayTitle(p: Properties): string {
  return text(p.name) || text(p.ref) || t('roads.railway', 'Railway')
}

/** The details of a feature of the module's layers; undefined for any other. */
export function roadDetails(feature: MapGeoJSONFeature): HTMLElement | undefined {
  const id = feature.layer.id
  const p = feature.properties
  if (id.startsWith(ROADS_PREFIX)) return detailsCard(roadTitle(p), [])
  if (id.startsWith(RAILWAYS_PREFIX)) return detailsCard(railwayTitle(p), [])
  if (id.startsWith(TRANSIT_PREFIX)) return detailsCard(transitTitle(p), [])
  return undefined
}
