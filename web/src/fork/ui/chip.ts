// Fork: a chip that's on or off (STYLE.md: several things each on or off, in a row):
// lit when on (oim-on), its state told to screen readers; chips in a row: `.oim-chips`.
// My layers' filters, a unit's marks, the picker's choices, a building's floors.
import './chip.css'
import { el } from 'redom'

/** A chip saying `label`; clicked, `toggled` gets what it should be now. */
export function toggleChip(
  label: string,
  on: boolean,
  toggled: (on: boolean) => void,
  title?: string
): HTMLButtonElement {
  const chip = el(`button.oim-chip${on ? '.oim-on' : ''}`, label, {
    type: 'button',
    'aria-pressed': String(on),
    ...(title ? { title } : {})
  }) as HTMLButtonElement
  chip.onclick = () => toggled(!on)
  return chip
}
