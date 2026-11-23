import { describe, expect, test } from 'vitest'
import { UserFeature, UserLayer } from '../model/model.ts'
import { explode, exportLayers, formatOf, readFile, toItem } from './formats.ts'

function layer(name: string, features: Omit<UserFeature, 'type'>[]): UserLayer {
  return {
    id: name,
    name,
    style: {},
    features: new Map(features.map((f) => [f.id, { type: 'Feature', ...f }]))
  }
}

const unit: Omit<UserFeature, 'type'> = {
  id: 'u1',
  geometry: { type: 'Point', coordinates: [7.3, 47.75] },
  properties: {
    kind: 'symbol',
    sidc: 'SHGPUCI----D---',
    name: '2nd company',
    notes: 'Seen at dawn.\nTwo trucks.',
    modifiers: { T: '2', H: 'dug in' },
    size: 1.5
  }
}
const road: Omit<UserFeature, 'type'> = {
  id: 'd1',
  geometry: {
    type: 'LineString',
    coordinates: [
      [7.3, 47.75, 250],
      [7.31, 47.76, 260]
    ]
  },
  properties: { kind: 'drawing', name: 'Road <closed> & "blocked"', color: '#ff0000', width: 4 }
}
const area: Omit<UserFeature, 'type'> = {
  id: 'a1',
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [7.3, 47.7],
        [7.4, 47.7],
        [7.4, 47.8],
        [7.3, 47.7]
      ]
    ]
  },
  properties: { kind: 'drawing' }
}
const layers = [layer('Enemy', [unit, road]), layer('Areas', [area])]

describe('export and import again: as it was', () => {
  test.each(['geojson', 'kml'] as const)('%s', (format) => {
    const items = readFile(`x.${format}`, exportLayers(layers, format))
    expect(items).toHaveLength(3)
    const [u, r, a] = items
    expect(u.properties).toEqual(unit.properties)
    expect(u.geometry).toEqual(unit.geometry)
    expect(r.properties).toMatchObject({
      kind: 'drawing',
      name: 'Road <closed> & "blocked"',
      color: '#ff0000'
    })
    // Heights dropped.
    expect((r.geometry as GeoJSON.LineString).coordinates[0]).toEqual([7.3, 47.75])
    expect(a.geometry.type).toBe('Polygon')
  })

  test('GPX: points and lines, names and notes (no areas, symbols or colours in GPX)', () => {
    const text = exportLayers(layers, 'gpx')
    expect(text).toContain('<wpt lat="47.75" lon="7.3"><name>2nd company</name>')
    const items = readFile('x.gpx', text)
    expect(items.map((i) => i.geometry.type).sort()).toEqual(['LineString', 'LineString', 'Point'])
    const point = items.find((i) => i.geometry.type === 'Point')!
    expect(point.properties).toMatchObject({ kind: 'marker', name: '2nd company' })
    expect(point.properties.notes).toContain('Seen at dawn.')
  })

  test('KML: a folder per layer, colours as aabbggrr, text escaped', () => {
    const text = exportLayers(layers, 'kml', 'Situation 1')
    expect(text.match(/<Folder>/g)).toHaveLength(2)
    expect(text).toContain('<color>ff0000ff</color>')
    expect(text).toContain('Road &lt;closed&gt; &amp; &quot;blocked&quot;')
    expect(() => new DOMParser().parseFromString(text, 'text/xml')).not.toThrow()
  })
})

describe('files from elsewhere', () => {
  test('GeoJSON: points become markers, the rest drawings; other fields in the notes', () => {
    const text = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [1, 2] },
          properties: { title: 'Depot', capacity: 40, nested: { a: 1 } }
        },
        {
          type: 'Feature',
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [
                [0, 0],
                [1, 1]
              ],
              [
                [2, 2],
                [3, 3]
              ]
            ]
          },
          properties: { stroke: '#00ff00', description: 'Two parts' }
        },
        { type: 'Feature', geometry: null, properties: {} },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0]] }, properties: {} }
      ]
    })
    const items = readFile('x.json', text)
    expect(items).toHaveLength(3)
    expect(items[0].properties).toEqual({ kind: 'marker', name: 'Depot', notes: 'capacity: 40' })
    expect(items[1].properties).toEqual({ kind: 'drawing', color: '#00ff00', notes: 'Two parts' })
    expect(items[2].geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [2, 2],
        [3, 3]
      ]
    })
  })

  test('a bare geometry; KML from another program', () => {
    expect(readFile('a.geojson', '{"type":"Point","coordinates":[5,6]}')).toHaveLength(1)
    const text = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>
      <Placemark><name>Pump</name><description>Old</description><Point><coordinates>7,48,0</coordinates></Point></Placemark>
      </Document></kml>`
    expect(readFile('b.kml', text)).toEqual([
      {
        geometry: { type: 'Point', coordinates: [7, 48] },
        properties: { kind: 'marker', name: 'Pump', notes: 'Old' }
      }
    ])
  })

  test('what a file is; what it is not', () => {
    expect(formatOf('a.KML', '')).toBe('kml')
    expect(formatOf('noext', ' <?xml version="1.0"?><gpx>')).toBe('gpx')
    expect(formatOf('noext', '{"type":')).toBe('geojson')
    expect(formatOf('a.txt', 'hello')).toBeNull()
    expect(() => readFile('a.txt', 'hello')).toThrow()
    expect(() => readFile('a.kml', '<kml><Document>')).toThrow()
  })

  test('a copy of a map feature keeps its fields', () => {
    const item = toItem(
      { type: 'Point', coordinates: [0, 0] },
      { kind: 'copy', voltage: '63000', layer: 'X', copy: '{"source":"s","sourceLayer":"l","layer":"y"}' }
    )
    expect(item.properties).toEqual({
      kind: 'copy',
      voltage: '63000',
      copy: { source: 's', sourceLayer: 'l', layer: 'y' }
    })
  })

  test('collections taken apart', () => {
    expect(
      explode({
        type: 'GeometryCollection',
        geometries: [
          {
            type: 'MultiPoint',
            coordinates: [
              [0, 0],
              [1, 1]
            ]
          },
          { type: 'Point', coordinates: [2, 2] }
        ]
      })
    ).toHaveLength(3)
  })
})

describe('measurements', () => {
  test('come back as they were: their type, ring distances and lock', () => {
    const rings = layer('M', [
      {
        id: 'r',
        geometry: { type: 'Point', coordinates: [7, 47] },
        properties: { kind: 'measure', measure: 'rings', radii: [500, 2000], locked: true }
      },
      {
        id: 'd',
        geometry: {
          type: 'LineString',
          coordinates: [
            [7, 47],
            [7.1, 47.1]
          ]
        },
        properties: { kind: 'measure', measure: 'distance', name: 'Road' }
      }
    ])
    for (const format of ['geojson', 'kml'] as const) {
      const [r, d] = readFile(`x.${format}`, exportLayers([rings], format))
      expect(r.properties).toEqual({ kind: 'measure', measure: 'rings', radii: [500, 2000], locked: true })
      expect(d.properties).toEqual({ kind: 'measure', measure: 'distance', name: 'Road' })
    }
  })
})
