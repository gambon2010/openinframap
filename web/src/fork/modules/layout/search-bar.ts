// Fork: the search box sits at the top left of the map (there's no header),
// instead of above the panels on the left. On a narrow screen it stays in the left
// column.
// The map container gets --oim-top-bar-left (where the space right of it starts),
// for anything centred in the top bar (My layers' toolbar).
import { Map } from 'maplibre-gl'

// Below this width the search box stays in the left column.
const MIN_WIDTH = 720

export function moveSearchToTopBar(map: Map) {
  const container = map.getContainer()
  const search = container.querySelector<HTMLElement>('.oim-search')
  const home = search?.parentElement
  if (!search || !home) return
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
    const left = 10
    search.style.left = `${left}px`
    search.style.top = '8px'
    container.style.setProperty('--oim-top-bar-left', `${left + search.offsetWidth + 10}px`)
  }
  place()
  // Its width changes with the fonts loading.
  new ResizeObserver(place).observe(search)
  window.addEventListener('resize', place)
}
