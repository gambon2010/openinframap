import { describe, expect, test } from 'vitest'
import { toFollow } from './follow.ts'

describe('open data follows its category', () => {
  test("the distribution and gas networks take Power's and Oil & gas's visibility", () => {
    const layers = [
      { id: 'power_line_1', visibility: 'visible' },
      { id: 'petroleum_pipeline', visibility: 'none' },
      { id: 'extra_power_line', visibility: 'none' },
      { id: 'extra_power_substation', visibility: 'visible' },
      { id: 'extra_gas_pipeline', visibility: 'visible' },
      { id: 'extra_icpe', visibility: 'none' }
    ]
    expect(toFollow(layers)).toEqual([
      ['extra_power_line', 'visible'],
      ['extra_gas_pipeline', 'none']
    ])
  })
})
