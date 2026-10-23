import { appendFileSync, writeFileSync } from 'node:fs'

const { SOURCE_SHA, IMAGE, STAGING_URL, GITHUB_SERVER_URL, GITHUB_REPOSITORY,
  GITHUB_RUN_ID, GITHUB_STEP_SUMMARY, IDENTITY_READY } = process.env
if (!/^[a-f0-9]{40}$/.test(SOURCE_SHA ?? '')) throw new Error('Full source SHA required')
if (!/^.+@sha256:[a-f0-9]{64}$/.test(IMAGE ?? '')) throw new Error('Immutable image digest required')
if (!STAGING_URL || new URL(STAGING_URL).protocol !== 'https:') throw new Error('HTTPS staging URL required')
if (!['true', 'false'].includes(IDENTITY_READY)) throw new Error('Explicit customer identity state required')
if (!GITHUB_SERVER_URL || !GITHUB_REPOSITORY || !GITHUB_RUN_ID || !GITHUB_STEP_SUMMARY) {
  throw new Error('GitHub run and summary metadata required')
}
const release = { sourceSha: SOURCE_SHA, image: IMAGE, url: STAGING_URL,
  run: `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`,
  schemaVersion: 1, environment: 'live', identityReady: IDENTITY_READY === 'true' }
writeFileSync('staging-release.json', JSON.stringify(release, null, 2) + '\n')
appendFileSync(GITHUB_STEP_SUMMARY,
  `### Verified live release\n\nSHA: ${SOURCE_SHA}\n\nImage: ${IMAGE}\n\nURL: ${STAGING_URL}\n\nCustomer identity configured: ${IDENTITY_READY}. Real provider sign-in requires separate verification.\n`)
