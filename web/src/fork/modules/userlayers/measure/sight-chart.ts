// Fork: a line of sight's profile as a chart (the split screen: sight-panel.ts),
// turned so the eye's line to the target is level: heights are metres above or below
// that line, so whatever rises above it shows at once however long the line. The
// ground and what stands on it (buildings grey, trees green) are as seen from the
// eye, the Earth's curvature in them as in the answer (sight.ts): the far ground
// bends away. The line dashed, green where it passes over everything, yellow where
// only trees rise above it, red where the ground or a building does, where the target is first hidden, and axes in metres
// and kilometres. Hovering it says where along the line (onHover: the sample under
// the pointer, null when it leaves).
// Drawn by hand in SVG: polygons, lines and ticks a chart library would only wrap.
import { svg } from 'redom'
import { t } from '../../../core/i18n.ts'
import { formatDistance } from '../../../core/earth.ts'
import { lineHeightAt, noticeableRuns, sightRuns, type ProfilePoint, type SightResult } from './sight.ts'
import { NOTICEABLE_PIXELS } from './sight.constants.ts'

const WIDTH = 1000
const HEIGHT = 520
const LEFT = 64
const RIGHT = 16
const TOP = 16
const BOTTOM = 40
/** About this many ticks along each axis. */
const TICKS = 6

/** A sample with terrain, its heights above the eye's line to the target (negative:
 * below it), as seen from the eye. */
interface Known {
  point: ProfilePoint
  distance: number
  ground: number
  top: number // the surface's top: the ground and what stands on it
}

export function sightChart(result: SightResult, onHover: (point: ProfilePoint | null) => void): SVGElement {
  const known = knownSamples(result)
  const length = result.profile[result.profile.length - 1]?.[0] || 1
  const scale = chartScale(known, length)
  const plot = svg(
    'svg.oim-ul-sight-chart',
    { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img' },
    ...axes(scale, length),
    groundShape(known, scale),
    ...standingShapes(known, scale),
    groundTop(known, scale),
    ...rayLines(result, scale),
    ...blockMark(result, known, scale)
  )
  hoverOn(plot, known, scale, onHover)
  return plot
}

function knownSamples(result: SightResult): Known[] {
  const known: Known[] = []
  for (const point of result.profile) {
    const [distance, ground, , standing, , apparent] = point
    const line = lineHeightAt(result, distance)
    if (ground === null || apparent === null || line === null) continue
    const top = apparent - line
    known.push({ point, distance, ground: top - standing, top })
  }
  return known
}

interface Scale {
  x: (distance: number) => number
  y: (height: number) => number
  low: number
  high: number
}

function chartScale(known: Known[], length: number): Scale {
  // The line itself (0) always in the chart.
  const heights = [0, ...known.map((k) => k.ground), ...known.map((k) => k.top)]
  const lowest = Math.min(...heights)
  const highest = Math.max(...heights)
  const pad = (highest - lowest) * 0.05 || 1
  const low = lowest - pad
  const high = highest + pad
  return {
    x: (d) => LEFT + (d / length) * (WIDTH - LEFT - RIGHT),
    y: (h) => HEIGHT - BOTTOM - ((h - low) / (high - low)) * (HEIGHT - TOP - BOTTOM),
    low,
    high
  }
}

/** A round step for about TICKS ticks over a range: 1, 2 or 5 times a power of ten. */
export function niceStep(range: number): number {
  const rough = range / TICKS
  const power = 10 ** Math.floor(Math.log10(rough))
  const steps = [1, 2, 5, 10].map((m) => m * power)
  return steps.find((step) => step >= rough) ?? 10 * power
}

function axes(scale: Scale, length: number): SVGElement[] {
  const parts: SVGElement[] = []
  const heightStep = niceStep(scale.high - scale.low)
  for (let h = Math.ceil(scale.low / heightStep) * heightStep; h <= scale.high; h += heightStep) {
    parts.push(svg('line.oim-ul-sight-grid', { x1: LEFT, x2: WIDTH - RIGHT, y1: scale.y(h), y2: scale.y(h) }))
    parts.push(
      svg('text.oim-ul-sight-tick', { x: LEFT - 6, y: scale.y(h) + 4, 'text-anchor': 'end' }, signedMetres(h))
    )
  }
  const distanceStep = niceStep(length)
  for (let d = 0; d <= length; d += distanceStep) {
    parts.push(
      svg('line.oim-ul-sight-grid', { x1: scale.x(d), x2: scale.x(d), y1: TOP, y2: HEIGHT - BOTTOM })
    )
    parts.push(
      svg(
        'text.oim-ul-sight-tick',
        { x: scale.x(d), y: HEIGHT - BOTTOM + 18, 'text-anchor': 'middle' },
        formatDistance(d)
      )
    )
  }
  return parts
}

/** "+50 m", "0 m", "−120 m": above or below the line. */
function signedMetres(height: number): string {
  const metres = Math.round(height)
  if (metres > 0) return `+${metres} m`
  if (metres < 0) return `−${-metres} m`
  return '0 m'
}

function groundShape(known: Known[], scale: Scale): SVGElement {
  const top = known.map((k) => `${scale.x(k.distance)},${scale.y(k.ground)}`).join(' ')
  const first = known[0]?.distance ?? 0
  const last = known[known.length - 1]?.distance ?? 0
  const base = scale.y(scale.low)
  return svg('polygon.oim-ul-sight-ground', {
    points: `${scale.x(first)},${base} ${top} ${scale.x(last)},${base}`
  })
}

/** Buildings and trees: a shape per run of the same kind, from the ground to their top. */
function standingShapes(known: Known[], scale: Scale): SVGElement[] {
  const shapes: SVGElement[] = []
  let run: Known[] = []
  const close = () => {
    if (run.length) shapes.push(standingShape(run, scale))
    run = []
  }
  for (const k of known) {
    const kind = k.point[4]
    if (!kind || (run.length && run[0].point[4] !== kind)) close()
    if (kind) run.push(k)
  }
  close()
  return shapes
}

function standingShape(run: Known[], scale: Scale): SVGElement {
  const top = run.map((k) => `${scale.x(k.distance)},${scale.y(k.top)}`)
  const bottom = [...run].reverse().map((k) => `${scale.x(k.distance)},${scale.y(k.ground)}`)
  return svg(`polygon.oim-ul-sight-${run[0].point[4]}`, { points: [...top, ...bottom].join(' ') })
}

function groundTop(known: Known[], scale: Scale): SVGElement {
  const points = known.map((k) => `${scale.x(k.distance)},${scale.y(k.ground)}`).join(' ')
  return svg('polyline.oim-ul-sight-ground-top', { points })
}

/** The eye's line to the target, level at 0, in runs of one state (clear, through
 * trees, blocked), the short trees and blocked ones widened to be seen. */
function rayLines(result: SightResult, scale: Scale): SVGElement[] {
  const metresPerUnit = 1 / (scale.x(1) - scale.x(0))
  return noticeableRuns(sightRuns(result), NOTICEABLE_PIXELS * metresPerUnit).map((run) =>
    svg(`line.oim-ul-sight-line-${run.state}`, {
      x1: scale.x(run.start),
      x2: scale.x(run.end),
      y1: scale.y(0),
      y2: scale.y(0)
    })
  )
}

/** Where the target is first hidden: a mark on what hides it. */
function blockMark(result: SightResult, known: Known[], scale: Scale): SVGElement[] {
  const blockedAt = result.blocked_at
  if (blockedAt === null || !known.length) return []
  const at = known.reduce((best, k) =>
    Math.abs(k.distance - blockedAt) < Math.abs(best.distance - blockedAt) ? k : best
  )
  return [
    svg('circle.oim-ul-sight-block', { cx: scale.x(at.distance), cy: scale.y(at.top), r: 7 }),
    svg(
      'text.oim-ul-sight-block-label',
      { x: scale.x(at.distance), y: scale.y(at.top) - 12, 'text-anchor': 'middle' },
      t('userlayers.sight-blocked-here', 'Hidden from here')
    )
  ]
}

/** A line and a dot following the pointer, and onHover with the sample under it. */
function hoverOn(
  plot: SVGElement,
  known: Known[],
  scale: Scale,
  onHover: (point: ProfilePoint | null) => void
) {
  const line = svg('line.oim-ul-sight-cursor', { y1: TOP, y2: HEIGHT - BOTTOM, visibility: 'hidden' })
  const dot = svg('circle.oim-ul-sight-cursor-dot', { r: 5, visibility: 'hidden' })
  plot.append(line, dot)
  plot.addEventListener('pointermove', (event) => {
    const box = plot.getBoundingClientRect()
    const x = ((event.clientX - box.left) / box.width) * WIDTH
    const k = nearest(known, scale, x)
    if (!k) return
    for (const [name, value] of [
      ['x1', scale.x(k.distance)],
      ['x2', scale.x(k.distance)]
    ] as const)
      line.setAttribute(name, String(value))
    dot.setAttribute('cx', String(scale.x(k.distance)))
    dot.setAttribute('cy', String(scale.y(k.top)))
    line.setAttribute('visibility', 'visible')
    dot.setAttribute('visibility', 'visible')
    onHover(k.point)
  })
  plot.addEventListener('pointerleave', () => {
    line.setAttribute('visibility', 'hidden')
    dot.setAttribute('visibility', 'hidden')
    onHover(null)
  })
}

/** The sample nearest an x on the chart (the samples are in order: a binary search). */
function nearest(known: Known[], scale: Scale, x: number): Known | undefined {
  let low = 0
  let high = known.length - 1
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (scale.x(known[middle].distance) < x) low = middle
    else high = middle
  }
  const [a, b] = [known[low], known[high]]
  if (!a || !b) return a ?? b
  return Math.abs(scale.x(a.distance) - x) <= Math.abs(scale.x(b.distance) - x) ? a : b
}
