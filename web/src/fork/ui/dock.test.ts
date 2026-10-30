import { describe, expect, test } from 'vitest'
import { el } from 'redom'
import { dock } from './dock.ts'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the right-hand dock', () => {
  const button1 = el('button') as HTMLButtonElement
  const panel1 = el('div')
  const button2 = el('button') as HTMLButtonElement
  const panel2 = el('div')
  let opened = 0
  document.body.append(button1, button2)
  dock.add(button1, panel1, () => opened++)
  dock.add(button2, panel2)

  test('a click opens a panel, another closes it', async () => {
    button1.click()
    await tick()
    expect(panel1.classList.contains('visible')).toBe(true)
    expect(button1.classList.contains('oim-dock-active')).toBe(true)
    expect(opened).toBe(1)
    button1.click()
    await tick()
    expect(panel1.classList.contains('visible')).toBe(false)
    expect(button1.getAttribute('aria-expanded')).toBe('false')
  })

  test('one panel at a time', async () => {
    button1.click()
    await tick()
    button2.click()
    await tick()
    expect(panel2.classList.contains('visible')).toBe(true)
    expect(panel1.classList.contains('visible')).toBe(false)
  })

  test("upstream's own click handler on the button doesn't run", async () => {
    let upstream = 0
    button2.onclick = () => upstream++
    button2.click()
    await tick()
    expect(upstream).toBe(0)
  })

  test('a panel closed by its own × updates its button', async () => {
    button1.click()
    await tick()
    panel1.classList.remove('visible')
    await tick()
    expect(button1.classList.contains('oim-dock-active')).toBe(false)
  })

  test('panels live in the dock, without the positions upstream gave them', () => {
    expect(panel1.parentElement).toBe(dock.el)
    const panel = el('div', { style: 'top: 50px; right: 10px' })
    dock.add(el('button'), panel)
    expect(panel.style.top).toBe('')
  })
})
