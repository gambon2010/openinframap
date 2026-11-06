// Fork: the colour new items get (drawings, markers, measurements, graphics: the
// kinds that have a colour), chosen in My layers' settings (ui/preferences.ts) and
// kept in this browser. Black at first. Items keep the colour they were made with;
// one without a colour of its own (made before) is drawn black (DEFAULT_COLOR).
import { readText, writeText } from '../../../core/storage.ts'
import { DEFAULT_COLOR, FeatureProps } from '../model/model.ts'
import { kindOf } from '../kinds/index.ts'

const KEY = 'oim-userlayers-new-colour'

export function newItemColour(): string {
  const kept = readText(KEY)
  return kept && /^#[0-9a-f]{6}$/i.test(kept) ? kept : DEFAULT_COLOR
}

export function setNewItemColour(colour: string) {
  writeText(KEY, colour)
}

/** A new item's properties with the colour for new items, if its kind has a colour
 * and it has none yet. */
export function withNewColour(properties: FeatureProps): FeatureProps {
  return kindOf(properties).coloured && !properties.color
    ? { ...properties, color: newItemColour() }
    : properties
}
