# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Individual disc golf players managing their owned discs and preparing a bag
configuration before visiting a course.

## Product Purpose

Help players choose and adjust a saved bag configuration for the course they plan
to play. Course-specific bag preparation is the core MVP, rather than general
inventory management alone.

## Operating Context

Players typically swap discs before going to a course. They need an understandable
GUI and a straightforward flow for adjusting the configuration.

The player manually builds a configuration and links it to a course. The course
is found by searching a sourced directory, with Nordic countries as the initial
coverage requirement.

## Capabilities and Constraints

- A bag means a saved bag configuration, not a distinct physical container.
- Configurations contain only discs from the player's collection.
- The same physical disc can appear in multiple saved configurations.
- MVP course matching is manual; automatic disc recommendations are excluded.
- Course data should come from official sources or an authorized provider such
  as UDisc if suitable access exists. Provider selection is unresolved.
- The repository currently uses React, TypeScript, Vite, and Supabase. Whether
  architecture changes are needed remains open.
- The broader refactor covers product, UX, and architecture, with implementation
  to follow requirements work.

## Product Principles

- Center the experience on preparing for a particular course.
- Make configuration adjustments easy to understand and perform.
- Keep ownership in the collection separate from membership in configurations.
- Use Moxfield's deck-building model as a conceptual workflow reference:
  a deck corresponds to a bag configuration. This does not establish a visual
  style or require copying its interface.

## Evidence on Hand

- Product requirements confirmed in the PRD discovery conversation.
- `src/pages/CoursesPage.tsx` and `src/hooks/useCoursePins.ts` contain the current
  course-pin and OpenStreetMap search implementation.
- `package.json` records the current application stack; the README's Alpine.js
  stack description does not reflect that manifest.
- `docs/prd-course-bag-configurations.md` records the MVP draft, source research,
  and unresolved decisions.
