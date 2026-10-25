import { useState, useEffect, useCallback, useRef } from 'react'
import { createRow, deleteRows, listRows, updateRow, readCourseCatalogue } from '../lib/data'
import { useAuth } from '../contexts/AuthContext'

export interface ClientPin {
  id: string
  courseName: string
  courseId: string | null
  bagId: string
  createdAt: number
}

export interface HoleAssignment {
  id: string
  course_pin_id: string
  hole_ref: string
  disc_id: string
  disc_name: string
}

export interface CatalogueCourse {
  id: string
  source: 'pdga'
  source_url: string | null
  expiresAt?: number
  name: string
  expected_holes: number | null
  mapped_holes: number
  city: string
  lat: number | null
  lon: number | null
}

interface CourseDetails {
  sourceUrl: string | null
  courseName?: string
  expiresAt?: number
}

export function useCoursePins(resolveDetails=false) {
  const { user } = useAuth()
  const [pins, setPins] = useState<ClientPin[]>([])
  const [pinsLoading, setPinsLoading] = useState(true)
  const [pinsError, setPinsError] = useState('')
  const [holeAssignments, setHoleAssignments] = useState<HoleAssignment[]>([])
  const [courseSuggestions, setCourseSuggestions] = useState<CatalogueCourse[]>([])
  const [courseError, setCourseError] = useState<string | null>(null)
  const [courseLoading, setCourseLoading] = useState(false)
  const [courseCache, setCourseCache] = useState<Record<string, CourseDetails>>({})
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSequence = useRef(0)
  useEffect(() => () => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchSequence.current++
  }, [])
  useEffect(() => {
    const expiries = [...Object.values(courseCache).map(c => c.expiresAt),
      ...courseSuggestions.map(c => c.expiresAt)].filter((time): time is number => time !== undefined)
    if (!expiries.length) return
    const timer = setTimeout(() => {
      setCourseCache(previous => Object.fromEntries(Object.entries(previous).filter(([, value]) =>
        !value.expiresAt || value.expiresAt > Date.now())))
      setCourseSuggestions(previous => previous.filter(c => !c.expiresAt || c.expiresAt > Date.now()))
    }, Math.max(0, Math.min(...expiries) - Date.now()))
    return () => clearTimeout(timer)
  }, [courseCache, courseSuggestions])

  const loadPins = useCallback(async () => {
    if (!user) return
    setPinsLoading(true)
    setPinsError('')
    try {
    const data = await listRows<{ id: string; course_name: string; course_id: string | null; bag_id: string; created_at: string }>('course_pins')
    setPins(
      (data || []).map(p => ({
        id: p.id,
        courseName: p.course_name || '',
        courseId: p.course_id || null,
        bagId: p.bag_id || '',
        createdAt: new Date(p.created_at).getTime(),
      }))
    )
    } catch(error) {
      setPinsError(error instanceof Error?error.message:'Could not load course links.')
      throw error
    } finally {setPinsLoading(false)}
  }, [user])

  const loadHoleAssignments = useCallback(async () => {
    if (!user) return
    const data = await listRows<HoleAssignment>('hole_assignments')
    setHoleAssignments(
      (data || []).map(h => ({
        id: h.id,
        course_pin_id: h.course_pin_id,
        hole_ref: h.hole_ref || '',
        disc_id: h.disc_id || '',
        disc_name: h.disc_name || '',
      }))
    )
  }, [user])

  useEffect(() => {
    void loadPins().catch(console.error)
    void loadHoleAssignments().catch(console.error)
  }, [loadPins, loadHoleAssignments])

  const createPin = async (courseName: string, courseId: string | null, bagId: string) => {
    if (!user) throw new Error('Sign in before pinning a course.')
    const pin = await createRow<{id:string}>('course_pins', { course_name: courseId?.startsWith('pdga:') ? 'PDGA course' : courseName, course_id: courseId, bag_id: bagId })
    await loadPins()
    return pin.id
  }

  const updatePin = async (pinId: string, updates: Partial<ClientPin>) => {
    const dbUpdates: Record<string, string | null> = {}
    if (updates.courseName !== undefined) dbUpdates.course_name = updates.courseName
    if (updates.courseId !== undefined) dbUpdates.course_id = updates.courseId
    if (updates.bagId !== undefined) dbUpdates.bag_id = updates.bagId

    await updateRow('course_pins', pinId, dbUpdates)
    await loadPins()
  }

  const deletePin = async (pinId: string) => {
    await deleteRows('course_pins', pinId)
    await loadPins()
    await loadHoleAssignments()
  }

  const assignDiscToHole = async (
    pinId: string,
    holeRef: string,
    discId: string,
    discName: string
  ) => {
    if (!user) return
    const existing = holeAssignments.find(
      h => h.course_pin_id === pinId && h.hole_ref === holeRef
    )
    if (existing) {
      await updateRow('hole_assignments', existing.id, { disc_id: discId, disc_name: discName })
    } else {
      await createRow('hole_assignments', {
        course_pin_id: pinId,
        hole_ref: holeRef,
        disc_id: discId,
        disc_name: discName,
      })
    }
    await loadHoleAssignments()
  }

  const clearHoleAssignment = async (pinId: string, holeRef: string) => {
    const existing = holeAssignments.find(
      h => h.course_pin_id === pinId && h.hole_ref === holeRef
    )
    if (existing) {
      await deleteRows('hole_assignments', existing.id)
      await loadHoleAssignments()
    }
  }

  const searchCourses = async (query: string) => {
    const sequence = ++searchSequence.current
    if (!query || query.trim().length < 2) { setCourseSuggestions([]); setCourseLoading(false); return }
    setCourseLoading(true)
    setCourseError(null)
    try {
      const result = await readCourseCatalogue<{ courses: CatalogueCourse[] }>(
        `courses?q=${encodeURIComponent(query.trim())}`)
      if (sequence === searchSequence.current) {
        setCourseSuggestions(result.courses)
      }
    } catch (error) {
      if (sequence === searchSequence.current) {
        setCourseSuggestions([])
        setCourseError(error instanceof Error ? error.message : 'Course search failed. Please try again.')
      }
    } finally {
      if (sequence === searchSequence.current) setCourseLoading(false)
    }
  }

  const searchCoursesDebounced = (query: string) => {
    searchSequence.current++
    setCourseSuggestions([])
    setCourseError(null)
    setCourseLoading(query.trim().length >= 2)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => void searchCourses(query), 300)
  }

  const loadCourseDetails = useCallback(async (pin: ClientPin) => {
    if (!pin.courseId) return
    setCourseLoading(true)
    setCourseError(null)
    try {
      const result = await readCourseCatalogue<{
        course: { name: string; source_url?: string }
        expiresAt?: number
      }>(`courses/${pin.courseId}/holes`)
      setCourseCache(prev => ({
        ...prev,
        [pin.id]: { sourceUrl: result.course.source_url ?? null,
          courseName: result.course.name, expiresAt: result.expiresAt },
      }))
    } catch (error) {
      setCourseError(error instanceof Error ? error.message : 'Could not load course details. Please try again.')
    } finally {
      setCourseLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const pin of pins) {
        if (cancelled) break
        if (resolveDetails&&pin.courseId?.startsWith('pdga:')) await loadCourseDetails(pin)
      }
    })()
    return () => { cancelled = true }
  }, [pins, loadCourseDetails,resolveDetails])

  const computeDiscUsageStats = (assignments: HoleAssignment[]) => {
    const stats = new Map<string, { count: number; courseCount: Set<string> }>()
    assignments.forEach(a => {
      if (!stats.has(a.disc_id)) {
        stats.set(a.disc_id, { count: 0, courseCount: new Set() })
      }
      const s = stats.get(a.disc_id)!
      s.count++
      s.courseCount.add(a.course_pin_id)
    })
    return new Map(
      Array.from(stats.entries()).map(([id, s]) => [
        id,
        { count: s.count, courseCount: s.courseCount.size },
      ])
    )
  }

  return {
    pinsLoading,
    pinsError,
    pins: pins.map(pin => pin.courseId?.startsWith('pdga:') ?
      { ...pin, courseName: courseCache[pin.id]?.courseName ?? 'PDGA course' } : pin),
    loadPins,
    createPin,
    updatePin,
    deletePin,
    holeAssignments,
    loadHoleAssignments,
    assignDiscToHole,
    clearHoleAssignment,
    searchCourses,
    searchCoursesDebounced,
    loadCourseDetails,
    courseSearch: searchCourses,
    courseLoading,
    courseSuggestions,
    courseError,
    courseCache,
    computeDiscUsageStats,
  }
}
