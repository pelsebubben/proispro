// coursePins — mirrors ClientPin. Ordered by created_at desc.
// holeAssignments are modeled as part of the courses surface and registered here
// too (mirrors HoleAssignment), scoped per owner.
import { FastifyInstance } from 'fastify'
import { registerCrud, Row, dateToMs } from './crud'

function pinFromRow(r: Row) {
  return {
    id: String(r.id ?? ''),
    courseName: String(r.course_name ?? ''),
    courseId: r.course_id == null ? null : String(r.course_id),
    bagId: String(r.bag_id ?? ''),
    createdAt: dateToMs(r.created_at),
  }
}

function pinToRow(body: Row, ownerId: string): Row {
  return {
    id: String(body.id),
    ownerId,
    course_name: String(body.courseName ?? ''),
    course_id: body.courseId == null || body.courseId === '' ? null : String(body.courseId),
    bag_id: String(body.bagId ?? ''),
  }
}

function holeFromRow(r: Row) {
  return {
    id: String(r.id ?? ''),
    course_pin_id: String(r.course_pin_id ?? ''),
    hole_ref: String(r.hole_ref ?? ''),
    disc_id: String(r.disc_id ?? ''),
    disc_name: String(r.disc_name ?? ''),
  }
}

function holeToRow(body: Row, ownerId: string): Row {
  return {
    id: String(body.id),
    ownerId,
    course_pin_id: String(body.course_pin_id ?? ''),
    hole_ref: String(body.hole_ref ?? ''),
    disc_id: body.disc_id == null || body.disc_id === '' ? null : String(body.disc_id),
    disc_name: String(body.disc_name ?? ''),
  }
}

export function registerCoursePinRoutes(app: FastifyInstance): void {
  registerCrud(app, {
    route: 'coursePins',
    table: 'course_pins',
    orderBy: 'created_at DESC',
    immutable: ['created_at'],
    fromRow: pinFromRow,
    toRow: pinToRow,
  })

  registerCrud(app, {
    route: 'holeAssignments',
    table: 'hole_assignments',
    orderBy: 'created_at ASC',
    immutable: ['created_at'],
    fromRow: holeFromRow,
    toRow: holeToRow,
  })
}
