import { describe, expect, test } from 'vitest'
import { placeTip, tipTarget } from './tooltip.ts'

describe('the tooltip', () => {
  const viewport = { width: 1000, height: 800 }
  const tip = { width: 120, height: 24 }

  test('centred below its element', () => {
    expect(placeTip({ left: 400, top: 100, right: 440, bottom: 130 }, tip, viewport)).toEqual({
      left: 360,
      top: 136
    })
  })

  test('above when there is no room below; kept on screen', () => {
    expect(placeTip({ left: 400, top: 760, right: 440, bottom: 790 }, tip, viewport).top).toBe(730)
    expect(placeTip({ left: 0, top: 100, right: 20, bottom: 130 }, tip, viewport).left).toBe(8)
    expect(placeTip({ left: 980, top: 100, right: 1000, bottom: 130 }, tip, viewport).left).toBe(872)
  })

  test("an element's title becomes its tip; an icon-only one keeps it as its name", () => {
    const icon = document.createElement('button')
    icon.title = 'Zoom in'
    const span = document.createElement('span')
    icon.append(span)
    expect(tipTarget(span)).toBe(icon)
    expect(icon.hasAttribute('title')).toBe(false)
    expect(icon.dataset.tip).toBe('Zoom in')
    expect(icon.getAttribute('aria-label')).toBe('Zoom in')
    const labelled = document.createElement('button')
    labelled.textContent = 'Save'
    labelled.title = 'Save your changes'
    tipTarget(labelled)
    expect(labelled.hasAttribute('aria-label')).toBe(false)
    expect(tipTarget(document.createElement('div'))).toBeNull()
  })
})
