import { describe, expect, it } from 'vitest'
import { readBackground } from './background.ts'

describe('the background kept in this browser', () => {
  it('reads what was kept, the high contrast map otherwise', () => {
    expect(readBackground(null, null)).toEqual({ colours: 'contrast', mode: 'map' })
    expect(readBackground('original', 'hybrid')).toEqual({ colours: 'original', mode: 'hybrid' })
    expect(readBackground('nonsense', 'nonsense')).toEqual({ colours: 'contrast', mode: 'map' })
  })
})
