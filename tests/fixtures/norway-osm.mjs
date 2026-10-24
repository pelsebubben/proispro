export function norwayFixture() {
  const timestamp = new Date().toISOString()
  const meta = { version: 1, timestamp }
  const courses = Array.from({ length: 12 }, (_, index) => ({
    type: 'node', id: index + 1, lat: 60 + index * .01, lon: 10,
    ...meta, tags: { leisure: 'disc_golf_course', name: `Norway test ${index + 1}`, holes: '18' },
  }))
  const hole = (id, ref, lat = 60, lon = 10) => ({ type: 'way', id, ...meta,
    tags: { disc_golf: 'hole', ref, par: '3', dist: '100' }, nodes: [id * 2, id * 2 + 1],
    geometry: [{ lat, lon }, { lat: lat + .0001, lon: lon + .0001 }] })
  return { osm3s: { timestamp_osm_base: timestamp }, elements: [...courses,
    { type: 'relation', id: 20, ...meta, bounds: { minlat: 60, maxlat: 60.001, minlon: 10, maxlon: 10.001 },
      tags: { type: 'disc_golf_course', name: 'Explicit course', holes: '2' },
      members: [{ type: 'way', ref: 101, role: 'hole' }, { type: 'way', ref: 102, role: 'hole' }] },
    hole(101, '1'), hole(102, '2'),
    // A nearby hole with no actual relationship must not join the relation.
    hole(103, '3'),
  ] }
}
