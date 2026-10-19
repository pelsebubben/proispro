import { useState, useEffect, useCallback } from 'react'
import { getStorage } from '../lib/storage'
import { useAuth } from '../contexts/AuthContext'
import type { ClientPin, HoleAssignment } from '../lib/storage/types'

export type { ClientPin, HoleAssignment }

export interface OSMCourse {
  osmId: number
  osmType: string
  name: string
  holes: string
  city: string
  lat: number | null
  lon: number | null
}

export interface ParsedHole {
  ref: string
  name: string
  lat: number | null
  lon: number | null
}

interface CourseMapData {
  lat: number
  lon: number
  holes: ParsedHole[]
  mapData?: any
}

const OSM_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
]

export function useCoursePins() {
  const { user } = useAuth()
  const [pins, setPins] = useState<ClientPin[]>([])
  const [holeAssignments, setHoleAssignments] = useState<HoleAssignment[]>([])
  const [pdgaSuggestions, setPdgaSuggestions] = useState<OSMCourse[]>([])
  const [courseLoading, setCourseLoading] = useState(false)
  const [courseCache, setCourseCache] = useState<Record<string, CourseMapData>>({})

  const loadPins = useCallback(async () => {
    if (!user) return
    const data = await getStorage().coursePins.list()
    setPins(data)
  }, [user])

  const loadHoleAssignments = useCallback(async () => {
    if (!user) return
    const data = await getStorage().holeAssignments.list()
    setHoleAssignments(data)
  }, [user])

  useEffect(() => {
    loadPins()
    loadHoleAssignments()
  }, [loadPins, loadHoleAssignments])

  const createPin = async (courseName: string, courseId: string | null, bagId: string) => {
    if (!user) return
    const ok = await getStorage().coursePins.create({ courseName, courseId, bagId })
    if (ok) {
      await loadPins()
    }
  }

  const updatePin = async (pinId: string, updates: Partial<ClientPin>) => {
    await getStorage().coursePins.update(pinId, {
      courseName: updates.courseName,
      courseId: updates.courseId,
      bagId: updates.bagId,
    })
    await loadPins()
  }

  const deletePin = async (pinId: string) => {
    await getStorage().holeAssignments.removeByPin(pinId)
    await getStorage().coursePins.remove(pinId)
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
      await getStorage().holeAssignments.update(existing.id, {
        disc_id: discId,
        disc_name: discName,
      })
    } else {
      await getStorage().holeAssignments.create({
        pinId,
        holeRef,
        discId,
        discName,
        userId: user.id,
      })
    }
    await loadHoleAssignments()
  }

  const clearHoleAssignment = async (pinId: string, holeRef: string) => {
    const existing = holeAssignments.find(
      h => h.course_pin_id === pinId && h.hole_ref === holeRef
    )
    if (existing) {
      await getStorage().holeAssignments.remove(existing.id)
      await loadHoleAssignments()
    }
  }

  const searchCourses = async (query: string) => {
    if (!query || query.length < 2) {
      setPdgaSuggestions([])
      return
    }
    setCourseLoading(true)
    try {
      const escaped = query.replace(/[\\'"]/g, '')
      const oql = `[out:json][timeout:10];(node["leisure"="disc_golf_course"]["name"~"${escaped}",i];way["leisure"="disc_golf_course"]["name"~"${escaped}",i];relation["leisure"="disc_golf_course"]["name"~"${escaped}",i];);out center 10;`

      let result = null
      for (const mirror of OSM_MIRRORS) {
        try {
          const res = await fetch(mirror, {
            method: 'POST',
            body: oql,
            headers: { 'Content-Type': 'text/plain' },
          })
          if (res.status === 429 || res.status === 504) continue
          if (res.ok) {
            result = await res.json()
            break
          }
        } catch {
          continue
        }
      }

      if (result && result.elements) {
        const courses: OSMCourse[] = result.elements.map((el: any) => ({
          osmId: el.id,
          osmType: el.type,
          name: el.tags?.name || '',
          holes: el.tags?.holes || '',
          city: el.tags?.['addr:city'] || '',
          lat: el.lat ?? el.center?.lat ?? null,
          lon: el.lon ?? el.center?.lon ?? null,
        }))
        setPdgaSuggestions(courses)
      } else {
        setPdgaSuggestions([])
      }
    } catch {
      setPdgaSuggestions([])
    } finally {
      setCourseLoading(false)
    }
  }

  let searchTimeout: NodeJS.Timeout | null = null
  const searchCoursesDebounced = (query: string) => {
    if (searchTimeout) clearTimeout(searchTimeout)
    searchTimeout = setTimeout(() => searchCourses(query), 400)
  }

  const downloadCourseMap = async (pin: ClientPin, lat: number, lon: number) => {
    if (!pin.id) return
    setCourseLoading(true)
    try {
      const oql = `[out:json][timeout:25];(node(around:2500,${lat},${lon})["disc_golf"];way(around:2500,${lat},${lon})["disc_golf"];relation(around:2500,${lat},${lon})["disc_golf"];);out center tags;`

      let result = null
      for (const mirror of OSM_MIRRORS) {
        try {
          const res = await fetch(mirror, {
            method: 'POST',
            body: oql,
            headers: { 'Content-Type': 'text/plain' },
          })
          if (res.status === 429 || res.status === 504) continue
          if (res.ok) {
            result = await res.json()
            break
          }
        } catch {
          continue
        }
      }

      if (!result || !result.elements) return

      const holeTypes = ['hole', 'tee', 'basket']
      let holes: ParsedHole[] = []
      for (const holeType of holeTypes) {
        const filtered = result.elements.filter(
          (el: any) => el.tags?.disc_golf === holeType
        )
        if (filtered.length > 0) {
          holes = filtered.map((el: any, idx: number) => ({
            ref: el.tags?.ref || String(idx + 1),
            name: el.tags?.name || '',
            lat: el.lat ?? el.center?.lat ?? null,
            lon: el.lon ?? el.center?.lon ?? null,
          }))
          break
        }
      }

      holes.sort((a, b) => {
        const aNum = parseInt(a.ref, 10)
        const bNum = parseInt(b.ref, 10)
        if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum
        return a.ref.localeCompare(b.ref)
      })

      setCourseCache(prev => ({
        ...prev,
        [pin.id]: { lat, lon, holes, mapData: result },
      }))
    } finally {
      setCourseLoading(false)
    }
  }

  const getHolesForPin = (pin: ClientPin): ParsedHole[] | null => {
    return courseCache[pin.id]?.holes || null
  }

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
    pins,
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
    downloadCourseMap,
    courseSearch: searchCourses,
    courseLoading,
    pdgaSuggestions,
    courseCache,
    getHolesForPin,
    computeDiscUsageStats,
  }
}
