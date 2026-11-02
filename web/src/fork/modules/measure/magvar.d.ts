// The `magvar` package has no types: the one function used (north.ts).
declare module 'magvar' {
  /** Magnetic declination in degrees (east positive), WMM2025. `when`: a Date or decimal year. */
  export function magvar(latitude: number, longitude: number, altitude?: number, when?: Date | number): number
}
