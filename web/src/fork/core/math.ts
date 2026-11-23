// Fork: small number helpers (no UI).

/** `value` kept between `min` and `max` (no rounding: callers round as they need). */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
