// Fork: tactical graphics (graphics.ts): its types.
import { LabelLanguage } from './labels.types.ts'

export type C5Ren = typeof import('@armyc2.c5isr.renderer/mil-sym-ts-web')

/** How many control points a graphic takes. */
export interface PointCount {
  min: number
  max: number
}

export type LonLat = [number, number]

export interface GraphicInput {
  /** 2525C code, 15 characters. */
  sidc: string
  /** Control points, [lon, lat]. */
  points: [number, number][]
  /** Text modifiers, keyed by 2525 letter (T, T1, H, W, W1...). */
  modifiers?: Record<string, string>
  color?: string
  /** 1:n */
  scale: number
  /** [west, south, east, north] of the view. */
  bbox?: [number, number, number, number]
  /** Whose labels (graphic-labels.ts): ours in this language, null the standard's;
   * default: the one chosen in My layers' settings. */
  language?: LabelLanguage | null
}
