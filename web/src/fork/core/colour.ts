// Fork: colours (no UI).

/** "#d32f2f" (or without "#") as [red, green, blue], 0-255; null if it isn't one. */
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null
}
