import { clamp } from '../core/math.ts'
// Fork: one tooltip for the whole page, instead of the browser's (a `title` waits for
// the pointer to rest, often doesn't show, and looks like nothing else here). Any
// element with a title, the fork's, upstream's or MapLibre's, gets it: the title
// moves to data-tip when the pointer first comes (so the browser's doesn't show
// too), and an icon-only button keeps it as its aria-label. Shown after a short
// pause (at once when going from one to the next), below the element or above when
// there's no room, kept on screen; hidden on a click, a key, a scroll or the wheel.
// Also on keyboard focus. Not for touch.
import './tooltip.css'

const DELAY = 350
/** Going from one element to the next within this: shown at once. */
const FOLLOW = 400
const GAP = 6
const EDGE = 8

/** Where a tooltip goes: centred below its element, or above if it doesn't fit; on screen. */
export function placeTip(
  target: { left: number; top: number; right: number; bottom: number },
  tip: { width: number; height: number },
  viewport: { width: number; height: number }
): { left: number; top: number } {
  const centre = (target.left + target.right) / 2
  const left = clamp(centre - tip.width / 2, EDGE, viewport.width - EDGE - tip.width)
  const below = target.bottom + GAP
  const top =
    below + tip.height <= viewport.height - EDGE ? below : Math.max(EDGE, target.top - GAP - tip.height)
  return { left: Math.max(EDGE, left), top }
}

/** The element whose tooltip a point is over (its title taken over), if any. */
export function tipTarget(el: Element | null): HTMLElement | null {
  const target = el?.closest<HTMLElement>('[title], [data-tip]') ?? null
  if (target?.hasAttribute('title')) {
    const text = target.getAttribute('title') ?? ''
    target.removeAttribute('title')
    if (text) {
      target.dataset.tip = text
      // An icon-only control: the title was its name for screen readers.
      if (!target.hasAttribute('aria-label') && !target.textContent?.trim())
        target.setAttribute('aria-label', text)
    }
  }
  return target?.dataset.tip ? target : null
}

class Tooltips {
  private el: HTMLElement | null = null
  private current: HTMLElement | null = null
  private timer = 0
  private hiddenAt = 0

  install() {
    if (this.el) return
    this.el = document.createElement('div')
    this.el.className = 'oim-tooltip'
    this.el.setAttribute('role', 'tooltip')
    document.body.append(this.el)
    let pending = false
    // From where the pointer is (disabled buttons send no pointer events of their own).
    document.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType === 'touch' || pending) return
        pending = true
        requestAnimationFrame(() => {
          pending = false
          this.over(tipTarget(document.elementFromPoint(e.clientX, e.clientY)))
        })
      },
      { passive: true }
    )
    document.addEventListener('pointerleave', () => this.over(null))
    for (const type of ['pointerdown', 'keydown', 'wheel']) {
      document.addEventListener(type, () => this.hide(), { capture: true, passive: true })
    }
    document.addEventListener('scroll', () => this.hide(), { capture: true, passive: true })
    document.addEventListener('focusin', (e) => {
      const target = e.target as HTMLElement
      if (target.matches?.(':focus-visible')) this.over(tipTarget(target), true)
    })
    document.addEventListener('focusout', () => this.over(null))
  }

  private over(target: HTMLElement | null, now = false) {
    if (target === this.current) return
    this.hide()
    this.current = target
    if (!target) return
    const soon = now || Date.now() - this.hiddenAt < FOLLOW
    this.timer = window.setTimeout(() => this.show(target), soon ? 0 : DELAY)
  }

  private show(target: HTMLElement) {
    const el = this.el
    if (!el || !target.isConnected || !target.dataset.tip) return
    el.textContent = target.dataset.tip
    el.classList.add('visible')
    const place = placeTip(
      target.getBoundingClientRect(),
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight }
    )
    el.style.left = `${place.left}px`
    el.style.top = `${place.top}px`
  }

  private hide() {
    window.clearTimeout(this.timer)
    if (this.el?.classList.contains('visible')) {
      this.el.classList.remove('visible')
      this.hiddenAt = Date.now()
    }
    // Shown again only after leaving and coming back.
    if (this.current) this.current = null
  }
}

export const tooltips = new Tooltips()
