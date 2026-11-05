// Fork: power supply mode's colours (modules/status/supply.ts sets them), shared
// with My layers: copies of power lines, substations and plants take their
// original's colour while the mode is on, and their own look when it's off.
export type Supply = 'green' | 'orange' | 'red' | 'risk'

// risk: would be red or orange if what has Suspected damage were lost too.
export const SUPPLY_COLOURS: Record<Supply, string> = {
  green: '#2b8a3e',
  orange: '#f08c00',
  red: '#d62828',
  risk: '#9c36b5'
}

/** Tile layers the mode colours, under one name each (an area and its point are one feature). */
const LAYERS: Record<string, string> = {
  power_line: 'power_line',
  power_substation: 'power_substation',
  power_substation_point: 'power_substation',
  power_plant: 'power_plant',
  power_plant_point: 'power_plant'
}

class SupplyColours {
  active = false
  private colours = new Map<string, Supply>()
  private listeners: (() => void)[] = []

  /** The mode on (with the features that aren't green, "power_line:123") or off. */
  set(active: boolean, colours: Record<string, Supply> = {}) {
    this.active = active
    this.colours = new Map(Object.entries(colours))
    for (const listener of this.listeners) listener()
  }

  /** A map feature's colour while the mode is on; null if off or not a grid feature. */
  of(sourceLayer: string | undefined, id: unknown): Supply | null {
    const layer = LAYERS[sourceLayer ?? '']
    if (!this.active || !layer || id === undefined || id === null) return null
    return this.colours.get(`${layer}:${id}`) ?? 'green'
  }

  onChange(listener: () => void) {
    this.listeners.push(listener)
  }
}

export const supplyColours = new SupplyColours()
