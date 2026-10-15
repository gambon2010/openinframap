import './search.css'
import i18next, { t } from 'i18next'
import { el } from 'redom'
import { IControl, Map } from 'maplibre-gl'
import PhotonSearch from './photon'
import CoordinatesSearch from './coordinates'
import OIMSearchProvider from './openinframap'

export type SearchResult = {
  latitude: number
  longitude: number
  name: string
  score: number
  description?: string
  // Fork: the map feature this result is, if any (substations and power plants
  // from the local database), so selecting it can open its details.
  feature?: { kind: 'substation' | 'plant'; osm_id: number }
}

export interface ISearchProvider {
  search(query: string, limit?: number): Promise<SearchResult[]>
}

export default class OIMSearch implements IControl {
  map?: Map
  container: HTMLElement
  input: HTMLInputElement
  dropdown: HTMLElement
  clearButton: HTMLElement
  selectedIndex: number = -1
  debounceTimer?: number
  isLoading: boolean = false
  currentResults: SearchResult[] = []
  searchProviders: ISearchProvider[]
  currentQuery: string = ''

  // Fork: called after the map flies to a selected result (opens its details).
  onSelect?: (result: SearchResult) => void

  constructor(onSelect?: (result: SearchResult) => void) {
    this.onSelect = onSelect
    this.searchProviders = [
      new CoordinatesSearch(),
      // Fork: places (cities, towns, villages…) come from the local database via
      // OIMSearchProvider, so upstream's online OpenCage geocoder isn't used.
      // Photon only searches when a server is configured (VITE_PHOTON_URL or the
      // Map sources panel); if it's unreachable the other providers still work.
      new OIMSearchProvider(i18next.language),
      new PhotonSearch(i18next.language)
    ]

    this.input = el('input', {
      type: 'text',
      className: 'oim-search-input'
    }) as HTMLInputElement

    this.clearButton = el(
      'button',
      {
        className: 'oim-search-clear',
        type: 'button',
        title: t('search.clear'),
        style: { display: 'none' }
      },
      '×'
    )

    this.dropdown = el('div', { className: 'oim-search-dropdown' })
    this.container = el(
      'div',
      { className: 'maplibregl-ctrl oim-search' },
      el('div', { className: 'oim-search-control' }, this.input, this.clearButton),
      this.dropdown
    )

    this.input.addEventListener('input', this.onInput.bind(this))
    this.input.addEventListener('keydown', this.onKeyDown.bind(this))
    this.clearButton.addEventListener('click', this.clearSearch.bind(this))
    this.dropdown.addEventListener('click', this.onDropdownClick.bind(this))
  }

  onAdd(map: Map): HTMLElement {
    this.map = map

    // For unclear reasons, some browsers will cause a move event when the input box is selected,
    // so don't clear search on move.
    this.map.on('click', () => {
      this.clearSearch()
    })
    return this.container
  }

  onRemove(): void {
    this.container.parentNode?.removeChild(this.container)
    this.map = undefined
  }

  async onInput(event: Event): Promise<void> {
    const query = (event.target as HTMLInputElement).value.trim()

    this.clearButton.style.display = query ? 'block' : 'none'

    if (this.currentQuery === query) {
      return
    }

    this.currentQuery = query

    if (!query || query.length < 3) {
      this.clearDropdown()
      return
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = undefined
    }

    this.isLoading = true
    this.showLoadingIndicator()

    this.debounceTimer = window.setTimeout(async () => {
      try {
        const results = await this.search(query)
        if (this.currentQuery !== query) {
          return
        }
        this.isLoading = false
        this.currentResults = results
        this.updateDropdown(results)

        if (results.length > 0) {
          this.selectedIndex = 0
          this.highlightSelected()
        }
      } catch (error) {
        this.isLoading = false
        this.currentResults = []
        console.error('Search error:', error)
      }
    }, 300)
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key == 'Escape') {
      event.preventDefault()
      this.clearSearch()
      return
    }

    if (this.currentResults.length === 0) return

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.currentResults.length - 1)
        this.highlightSelected()
        break
      case 'ArrowUp':
        event.preventDefault()
        this.selectedIndex = Math.max(this.selectedIndex - 1, -1)
        this.highlightSelected()
        break
      case 'Enter':
        event.preventDefault()
        if (this.selectedIndex >= 0 && this.selectedIndex < this.currentResults.length) {
          this.selectItem(this.currentResults[this.selectedIndex])
        }
        break
    }
  }

  highlightSelected(): void {
    const items = this.dropdown.querySelectorAll('.oim-search-item')
    items.forEach((item) => {
      item.classList.remove('selected')
    })

    if (this.selectedIndex >= 0) {
      items[this.selectedIndex].classList.add('selected')
    }
  }

  selectItem(result: SearchResult): void {
    if (result) {
      this.map!.flyTo({ center: [result.longitude, result.latitude], zoom: 14 })
      this.input.value = result.name
      this.clearDropdown()
      this.onSelect?.(result)
    }
  }

  onDropdownClick(event: MouseEvent): void {
    const target = event.target as HTMLElement
    const item = target.closest('.oim-search-item') as HTMLElement
    if (item && item.dataset.index) {
      const index = parseInt(item.dataset.index, 10)
      if (!isNaN(index) && index >= 0 && index < this.currentResults.length) {
        this.selectItem(this.currentResults[index])
      }
    }
  }

  clearSearch(): void {
    this.input.value = ''
    this.clearDropdown()
    this.clearButton.style.display = 'none'
    this.input.blur()
  }

  clearDropdown(): void {
    this.dropdown.innerHTML = ''
    this.selectedIndex = -1
    this.isLoading = false
    this.currentResults = []
  }

  showLoadingIndicator(): void {
    this.clearDropdown()
    const loadingEl = el('div.oim-search-status', '...')
    this.dropdown.appendChild(loadingEl)
  }

  updateDropdown(results: SearchResult[]): void {
    this.clearDropdown()
    this.currentResults = results

    if (results.length === 0) {
      const noResultsEl = el('div.oim-search-empty', t('search.no-results'))
      this.dropdown.appendChild(noResultsEl)
      return
    }

    const list = el('ol', { className: 'oim-search-list' })
    results.forEach((result, index) => {
      const item = el(
        'li',
        {
          className: 'oim-search-item',
          dataset: {
            index: index.toString()
          }
        },
        el('span.search-result-name', result.name),
        el('div', { className: 'oim-search-description' }, result.description || '')
      )
      list.appendChild(item)
    })

    this.dropdown.appendChild(list)
  }

  async search(query: string): Promise<SearchResult[]> {
    // One provider failing (e.g. place search while offline) mustn't hide the
    // results of the others.
    const settled = await Promise.allSettled(
      this.searchProviders.map((provider) => provider.search(query, 5))
    )
    const results = settled.flatMap((result) => {
      if (result.status === 'fulfilled') {
        return result.value
      }
      console.warn('Search provider failed:', result.reason)
      return []
    })

    return dropDuplicates(results.sort((a, b) => b.score - a.score)).slice(0, 10)
  }
}

// The same place can come from more than one provider (local database and
// Photon), or twice from one (mapped as a point and an area). Keep the
// best-scored result for each name within about 5 km.
const DUPLICATE_DISTANCE = 0.05

function dropDuplicates(results: SearchResult[]): SearchResult[] {
  const kept: SearchResult[] = []
  for (const result of results) {
    const duplicate = kept.some(
      (k) =>
        k.name.toLowerCase() === result.name.toLowerCase() &&
        Math.abs(k.latitude - result.latitude) < DUPLICATE_DISTANCE &&
        Math.abs(k.longitude - result.longitude) < DUPLICATE_DISTANCE
    )
    if (!duplicate) kept.push(result)
  }
  return kept
}
