import { useState } from 'react'
import catalogue from '../data/curated-courses.json'

export function CuratedCourses() {
  const [query, setQuery] = useState('')
  const matching = catalogue.courses.filter(course =>
    course.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))

  return <section className="curated-courses" aria-labelledby="curated-courses-title">
    <h2 id="curated-courses-title">Browse curated courses</h2>
    <p className="bag-hint">A small, owner-selected catalog available without the course API or database.
      Course details are being verified.</p>
    <label className="curated-course-search">Find a curated course
      <input type="search" value={query} onChange={event => setQuery(event.target.value)}
        placeholder="Search course name" />
    </label>
    {matching.length === 0
      ? <p role="status">No curated courses match your search.</p>
      : <ul className="curated-course-list">{matching.map(course =>
        <li key={course.id}>
          <details>
            <summary>{course.name}</summary>
            <p>{course.details ?? 'Course details are not available yet.'}</p>
            <p className="bag-hint">Source: {course.source}
              {course.sourceUrl && <> · <a href={course.sourceUrl} target="_blank" rel="noopener noreferrer">View source</a></>}
            </p>
          </details>
        </li>)}</ul>}
    <p className="bag-hint">Bag links and private game plans still require the database.</p>
  </section>
}
