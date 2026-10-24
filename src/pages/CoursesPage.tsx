import { useEffect, useState } from 'react'
import { ClientDisc, ClientBag } from '../utils/disc'
import { useCoursePins, ClientPin, CatalogueCourse } from '../hooks/useCoursePins'
import { readCourseCatalogue } from '../lib/data'

interface CoursesPagesProps {
  allDiscs: ClientDisc[]
  allBags: ClientBag[]
}

export function CoursesPage({ allDiscs, allBags }: CoursesPagesProps) {
  const {
    pins,
    createPin,
    deletePin,
    holeAssignments,
    assignDiscToHole,
    clearHoleAssignment,
    searchCoursesDebounced,
    downloadCourseMap,
    courseLoading,
    courseSuggestions,
    courseError,
    providerNotice,
    catalogueUpdatedAt,
    courseCache,
    getHolesForPin,
  } = useCoursePins()

  const [expandedPinId, setExpandedPinId] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [courseQuery, setCourseQuery] = useState('')
  const [selectedCourse, setSelectedCourse] = useState<CatalogueCourse | null>(null)
  const [selectedBagId, setSelectedBagId] = useState('')
  const [showGamePlan, setShowGamePlan] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  useEffect(() => {
    if (!selectedCourse?.expiresAt) return
    const timer = setTimeout(() => {
      setSelectedCourse(null)
      setCourseQuery('')
      searchCoursesDebounced('')
    }, Math.max(0, selectedCourse.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [selectedCourse])

  const exportCatalogue = async () => {
    setExporting(true)
    setExportError(null)
    try {
      const catalogue = await readCourseCatalogue<unknown>('courses/export')
      const url = URL.createObjectURL(new Blob([JSON.stringify(catalogue)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'griplock-norway-osm-catalogue.json'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Could not export the course catalogue.')
    } finally { setExporting(false) }
  }

  const handlePinCourse = () => {
    setShowModal(true)
    setCourseQuery('')
    searchCoursesDebounced('')
    setSelectedCourse(null)
    setSelectedBagId(allBags[0]?.id || '')
  }

  const handleSavePin = async () => {
    if (!selectedCourse) {
      const name = courseQuery.trim()
      if (name && selectedBagId) {
        await createPin(name, null, selectedBagId)
        setShowModal(false)
      }
    } else {
      if (selectedCourse.expiresAt && selectedCourse.expiresAt <= Date.now()) return
      const courseId = selectedCourse.id
      await createPin(selectedCourse.name, courseId, selectedBagId)
      setShowModal(false)
    }
  }

  const handleDownloadMap = async (pin: ClientPin) => {
    if (!pin.courseId) return
    await downloadCourseMap(pin)
  }

  const handleDelete = async (pinId: string) => {
    if (confirm('Delete this course pin? Hole assignments will also be deleted.')) {
      await deletePin(pinId)
    }
  }

  const handleCourseQueryChange = (value: string) => {
    setCourseQuery(value)
    setSelectedCourse(null)
    searchCoursesDebounced(value)
  }

  const handleSelectCourse = (course: CatalogueCourse) => {
    setSelectedCourse(course)
    setCourseQuery(course.name)
  }

  const handleHoleAssignment = async (pin: ClientPin, holeRef: string, discId: string) => {
    if (!discId) {
      await clearHoleAssignment(pin.id, holeRef)
    } else {
      const disc = allDiscs.find(d => d.id === discId)
      if (disc) {
        await assignDiscToHole(pin.id, holeRef, discId, disc.name)
      }
    }
  }

  const getBagForPin = (pin: ClientPin) => allBags.find(b => b.id === pin.bagId)

  const getDiscsForPin = (pin: ClientPin): ClientDisc[] => {
    const bag = getBagForPin(pin)
    if (!bag) return []
    return allDiscs.filter(d => bag.disc_ids.includes(d.id))
  }

  const getAssignedDiscId = (pinId: string, holeRef: string): string => {
    const assignment = holeAssignments.find(
      a => a.course_pin_id === pinId && a.hole_ref === holeRef
    )
    return assignment?.disc_id || ''
  }

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1.5rem',
        }}
      >
        <h2 style={{ margin: 0, color: 'var(--clr-text)' }}>
          🗺 {pins.length} {pins.length === 1 ? 'course' : 'courses'} pinned
        </h2>
        <button
          onClick={handlePinCourse}
          style={{
            padding: '0.75rem 1.5rem',
            background: 'var(--clr-accent)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius)',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          + Pin Course
        </button>
      </div>

      <p className="bag-hint">
        Norway course catalogue · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors · ODbL</a>.
        {' '}<a href="https://www.pdga.com/" target="_blank" rel="noopener noreferrer">Player, event, and course data provided by PDGA.</a>
        {' '}Hole mapping may be incomplete; layout variants are not inferred.
        {catalogueUpdatedAt && <> Last synced {new Date(catalogueUpdatedAt).toLocaleDateString()}.</>}
      </p>
      <button type="button" onClick={exportCatalogue} disabled={exporting}>
        {exporting ? 'Exporting catalogue...' : 'Download ODbL course data'}
      </button>
      <p className="bag-hint">The ODbL download contains OSM data only, not PDGA records. PDGA course details do not include hole layouts.</p>
      {exportError && <p role="alert">{exportError}</p>}
      {courseError && <p role="alert">{courseError} Please retry your search or load the holes again.</p>}

      {/* Pin Modal */}
      {showModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowModal(false)}
        >
          <div
            style={{
              background: 'var(--clr-surface)',
              padding: '2rem',
              borderRadius: 'var(--radius)',
              maxWidth: '500px',
              width: '90%',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 1rem', color: 'var(--clr-text)' }}>Pin a Course</h3>

            <div style={{ marginBottom: '1rem', position: 'relative' }}>
              <label htmlFor="course-query"
                style={{
                  display: 'block',
                  marginBottom: '0.5rem',
                  fontSize: '0.9rem',
                  color: 'var(--clr-muted)',
                }}
              >
                Course Name (search Norway catalogue or type custom)
              </label>
              <input
                id="course-query"
                type="text"
                value={courseQuery}
                onChange={e => handleCourseQueryChange(e.target.value)}
                placeholder="Start typing course name..."
                maxLength={100}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  background: 'var(--clr-bg)',
                  border: '1px solid var(--clr-border)',
                  borderRadius: 'var(--radius)',
                  color: 'var(--clr-text)',
                  fontSize: '1rem',
                }}
              />
              {courseLoading && (
                <div
                  style={{
                    marginTop: '0.5rem',
                    fontSize: '0.85rem',
                    color: 'var(--clr-muted)',
                  }}
                >
                  Searching Norway catalogue...
                </div>
              )}
              {courseError && <p role="alert">{courseError} Try searching again.</p>}
              {providerNotice && <p role="status">{providerNotice}</p>}
              {!courseLoading && !courseError && courseQuery.trim().length >= 2 && !selectedCourse && courseSuggestions.length === 0 &&
                <p className="bag-hint">No matching Norwegian courses found. The catalogue may be incomplete.</p>}
              {courseSuggestions.length > 0 && !selectedCourse && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    marginTop: '0.5rem',
                    background: 'var(--clr-surface2)',
                    border: '1px solid var(--clr-border)',
                    borderRadius: 'var(--radius)',
                    maxHeight: '200px',
                    overflowY: 'auto',
                    zIndex: 10,
                  }}
                >
                  {courseSuggestions.map(course => (
                    <div key={course.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectCourse(course)}
                      style={{
                        padding: '0.75rem',
                        cursor: 'pointer',
                        borderBottom: '1px solid var(--clr-border)',
                        width: '100%', textAlign: 'left', background: 'transparent', borderTop: 0, borderLeft: 0, borderRight: 0,
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'var(--clr-bg)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <div style={{ color: 'var(--clr-text)', fontWeight: 500 }}>
                        {course.name}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--clr-muted)' }}>
                        {course.city} · {course.mapped_holes} mapped / {course.expected_holes ?? '?'} listed holes
                        {' '}· {course.source === 'pdga' ? 'PDGA · layout unavailable' : 'OSM'}
                      </div>
                    </button>
                    {course.source === 'pdga' && course.source_url && <a href={course.source_url}
                      target="_blank" rel="noopener noreferrer">{course.name} on PDGA</a>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label htmlFor="course-bag"
                style={{
                  display: 'block',
                  marginBottom: '0.5rem',
                  fontSize: '0.9rem',
                  color: 'var(--clr-muted)',
                }}
              >
                Link to Bag
              </label>
              <select
                id="course-bag"
                value={selectedBagId}
                onChange={e => setSelectedBagId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  background: 'var(--clr-bg)',
                  border: '1px solid var(--clr-border)',
                  borderRadius: 'var(--radius)',
                  color: 'var(--clr-text)',
                  fontSize: '1rem',
                }}
              >
                <option value="">Select a bag</option>
                {allBags.map(bag => (
                  <option key={bag.id} value={bag.id}>
                    {bag.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <button
                onClick={() => setShowModal(false)}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  background: 'var(--clr-surface2)',
                  color: 'var(--clr-text)',
                  border: 'none',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSavePin}
                disabled={!courseQuery.trim() || !selectedBagId}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  background:
                    !courseQuery.trim() || !selectedBagId
                      ? 'var(--clr-surface2)'
                      : 'var(--clr-accent)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 'var(--radius)',
                  cursor: !courseQuery.trim() || !selectedBagId ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                }}
              >
                Save Pin
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pin List */}
      {pins.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '3rem 1rem',
            color: 'var(--clr-muted)',
          }}
        >
          <div style={{ fontSize: '3rem' }}>🗺</div>
          <p style={{ marginTop: '1rem' }}>No courses pinned yet</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {pins.map(pin => {
            const bag = getBagForPin(pin)
            const holes = getHolesForPin(pin)
            const isExpanded = expandedPinId === pin.id
            const showPlan = showGamePlan === pin.id

            return (
              <div
                key={pin.id}
                style={{
                  background: 'var(--clr-surface)',
                  borderRadius: 'var(--radius)',
                  padding: '1.5rem',
                  border: '1px solid var(--clr-border)',
                }}
              >
                {/* Pin Header */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <h3 style={{ margin: '0 0 0.5rem', color: 'var(--clr-text)' }}>
                      {pin.courseId?.startsWith('pdga:') && courseCache[pin.id]?.sourceUrl ?
                        <a href={courseCache[pin.id].sourceUrl!} target="_blank"
                          rel="noopener noreferrer">{pin.courseName}</a> : pin.courseName}
                    </h3>
                    <div style={{ fontSize: '0.9rem', color: 'var(--clr-muted)' }}>
                      Bag: {bag?.name || 'Unknown'}
                      {holes && <span> · {pin.courseId?.startsWith('pdga:') ? 'Layout unavailable' : `${holes.length} mapped holes`}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {pin.courseId && !holes && (
                      <button
                        onClick={() => handleDownloadMap(pin)}
                        disabled={courseLoading}
                        style={{
                          padding: '0.5rem 1rem',
                          background: 'var(--clr-accent)',
                          color: 'white',
                          border: 'none',
                          borderRadius: 'var(--radius)',
                          cursor: courseLoading ? 'wait' : 'pointer',
                          fontSize: '0.85rem',
                        }}
                      >
                        {pin.courseId.startsWith('pdga:') ? 'Load course details' : 'Load holes'}
                      </button>
                    )}
                    {pin.courseId && (
                      <>
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=disc+golf+${encodeURIComponent(
                            pin.courseName
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            padding: '0.5rem',
                            background: 'var(--clr-surface2)',
                            color: 'var(--clr-text)',
                            borderRadius: 'var(--radius)',
                            textDecoration: 'none',
                            fontSize: '0.85rem',
                          }}
                        >
                          🧭
                        </a>
                        {(!pin.courseId.startsWith('pdga:') || courseCache[pin.id]?.sourceUrl) && <a
                          href={pin.courseId.startsWith('pdga:') ? courseCache[pin.id].sourceUrl! :
                            `https://www.openstreetmap.org/${pin.courseId.replace('osm:', '').replace(':', '/')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            padding: '0.5rem',
                            background: 'var(--clr-surface2)',
                            color: 'var(--clr-text)',
                            borderRadius: 'var(--radius)',
                            textDecoration: 'none',
                            fontSize: '0.85rem',
                          }}
                        >
                          🗺
                        </a>}
                      </>
                    )}
                    <button
                      onClick={() => handleDelete(pin.id)}
                      style={{
                        padding: '0.5rem',
                        background: 'var(--clr-danger)',
                        color: 'white',
                        border: 'none',
                        borderRadius: 'var(--radius)',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                      }}
                    >
                      🗑
                    </button>
                  </div>
                </div>

                {/* Holes */}
                {holes && (
                  <div style={{ marginTop: '1rem' }}>
                    <p className="bag-hint">{courseCache[pin.id]?.coverageNote}</p>
                    {holes.length === 0 && !pin.courseId?.startsWith('pdga:') &&
                      <p>No confidently associated holes are available. This does not mean the course has no holes.</p>}
                    {holes.length > 0 && <button
                      onClick={() => setExpandedPinId(isExpanded ? null : pin.id)}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        background: 'var(--clr-surface2)',
                        color: 'var(--clr-text)',
                        border: 'none',
                        borderRadius: 'var(--radius)',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                      }}
                    >
                      {isExpanded ? '▼' : '▶'} Holes ({holes.length})
                    </button>}
                    {isExpanded && (
                      <div
                        style={{
                          marginTop: '0.5rem',
                          maxHeight: '200px',
                          overflowY: 'auto',
                          padding: '0.5rem',
                          background: 'var(--clr-bg)',
                          borderRadius: 'var(--radius)',
                        }}
                      >
                        {holes.map(hole => (
                          <div
                            key={hole.ref}
                            style={{
                              padding: '0.5rem',
                              borderBottom: '1px solid var(--clr-border)',
                              fontSize: '0.9rem',
                              color: 'var(--clr-text)',
                            }}
                          >
                            Hole {hole.ref}
                            {hole.name && <span> - {hole.name}</span>}
                            {hole.par !== null && <span> · Par {hole.par}</span>}
                            {hole.length_m !== null && <span> · {hole.length_m} m</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Game Plan */}
                {holes && holes.length > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    <button
                      onClick={() => setShowGamePlan(showPlan ? null : pin.id)}
                      style={{
                        width: '100%',
                        padding: '0.75rem',
                        background: 'var(--clr-accent)',
                        color: 'white',
                        border: 'none',
                        borderRadius: 'var(--radius)',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      {showPlan ? '▼' : '▶'} Game Plan
                    </button>
                    {showPlan && (
                      <div
                        style={{
                          marginTop: '1rem',
                          display: 'grid',
                          gap: '0.75rem',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                        }}
                      >
                        {holes.map(hole => {
                          const assignedId = getAssignedDiscId(pin.id, hole.ref)
                          const bagDiscs = getDiscsForPin(pin)
                          return (
                            <div
                              key={hole.ref}
                              style={{
                                padding: '1rem',
                                background: 'var(--clr-surface2)',
                                borderRadius: 'var(--radius)',
                              }}
                            >
                              <div
                                style={{
                                  marginBottom: '0.5rem',
                                  fontWeight: 600,
                                  color: 'var(--clr-text)',
                                }}
                              >
                                Hole {hole.ref}
                              </div>
                              <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <select
                                  value={assignedId}
                                  onChange={e => handleHoleAssignment(pin, hole.ref, e.target.value)}
                                  style={{
                                    flex: 1,
                                    padding: '0.5rem',
                                    background: 'var(--clr-bg)',
                                    border: '1px solid var(--clr-border)',
                                    borderRadius: 'var(--radius)',
                                    color: 'var(--clr-text)',
                                    fontSize: '0.9rem',
                                  }}
                                >
                                  <option value="">Select disc...</option>
                                  {bagDiscs.map(disc => (
                                    <option key={disc.id} value={disc.id}>
                                      {disc.name}
                                    </option>
                                  ))}
                                </select>
                                {assignedId && (
                                  <button
                                    onClick={() => clearHoleAssignment(pin.id, hole.ref)}
                                    style={{
                                      padding: '0.5rem',
                                      background: 'var(--clr-danger)',
                                      color: 'white',
                                      border: 'none',
                                      borderRadius: 'var(--radius)',
                                      cursor: 'pointer',
                                      fontSize: '0.85rem',
                                    }}
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
