// Fork: the search box sits in the top bar, just right of the header ("Open
// Infrastructure Map", about, stats...), instead of above the panels on the left.
// On a narrow screen there's no room beside the header: it stays on the left.
// The map container gets --oim-top-bar-left (where the space right of it starts),
// for anything centred in the top bar (My layers' toolbar).
import { Map } from 'maplibre-gl'

// Below this width the search box stays in the left column.
const MIN_WIDTH = 720

export function moveSearchToTopBar(map: Map) {
  const container = map.getContainer()
  const search = container.querySelector<HTMLElement>('.oim-search')
  const header = document.querySelector<HTMLElement>('header')
  const home = search?.parentElement
  if (!search || !header || !home) return
  const place = () => {
    if (window.innerWidth < MIN_WIDTH) {
      if (search.parentElement !== home) home.prepend(search)
      search.classList.remove('oim-search-top')
      search.style.left = search.style.top = ''
      container.style.removeProperty('--oim-top-bar-left')
      return
    }
    if (search.parentElement !== container) container.append(search)
    search.classList.add('oim-search-top')
    const box = container.getBoundingClientRect()
    const head = header.getBoundingClientRect()
    const left = Math.round(head.right - box.left + 10)
    search.style.left = `${left}px`
    search.style.top = `${Math.max(6, Math.round(head.top - box.top + (head.height - search.offsetHeight) / 2))}px`
    container.style.setProperty('--oim-top-bar-left', `${left + search.offsetWidth + 10}px`)
  }
  place()
  // The header's width changes with the language and the fonts loading.
  new ResizeObserver(place).observe(header)
  window.addEventListener('resize', place)
}
