import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from 'yaml'

const names = ['ci.yml', 'infra.yml', 'staging.yml', 'deploy.yml', 'squad-ci.yml']
const sources = Object.fromEntries(await Promise.all(names.map(async name => [
  name, await readFile(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8'),
])))
const lock = JSON.parse(await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'))
const playwrightVersion = lock.packages['node_modules/@playwright/test'].version

function checkTrustBoundary(files) {
  const workflows = Object.fromEntries(Object.entries(files).map(([name, text]) => [name, parse(text)]))
  for (const [name, workflow] of Object.entries(workflows)) {
    assert.equal(workflow.permissions.contents, 'read', `${name}: default read-only token`)
    assert.equal(workflow.permissions['id-token'], undefined, `${name}: no workflow-wide OIDC`)
    assert.equal(workflow.on.pull_request_target, undefined, `${name}: no privileged PR event`)
    for (const job of Object.values(workflow.jobs)) {
      assert.ok(job['timeout-minutes'] > 0, `${name}: bounded jobs`)
      for (const step of job.steps ?? []) {
        if (!step.uses) continue
        assert.match(step.uses, /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/, `${name}: pinned action`)
        if (step.uses.startsWith('actions/checkout@')) {
          assert.equal(step.with['persist-credentials'], false, `${name}: no persisted token`)
        }
      }
    }
  }
  const ci = workflows['ci.yml']
  assert.deepEqual(ci.permissions, { contents: 'read' })
  for (const browser of [ci.jobs.browser, workflows['staging.yml'].jobs.browser]) {
    assert.match(browser.container.image, new RegExp(`^mcr.microsoft.com/playwright:v${playwrightVersion.replaceAll('.', '\\.')}-noble@sha256:[a-f0-9]{64}$`))
    assert.equal(browser.permissions?.['id-token'], undefined, 'browser gets no cloud identity')
    assert.equal(browser.environment, undefined, 'browser gets no environment secrets')
  }
  for (const job of Object.values(ci.jobs)) assert.equal(job['runs-on'], 'ubuntu-24.04')
  assert.ok(Object.hasOwn(ci.on, 'pull_request'))
  assert.equal(ci.on.pull_request, null, 'all PR changes get the same required check')
  assert.deepEqual(ci.jobs.required.needs, ['application', 'browser', 'api', 'infrastructure'])
  assert.equal(ci.jobs.required.if, '${{ always() }}')
  const requiredGuard = ci.jobs.required.steps[0].run
  for (const result of ['APPLICATION', 'BROWSER', 'API', 'INFRASTRUCTURE']) {
    assert.ok(requiredGuard.includes(`test "$${result}" = success`), `required gate checks ${result}`)
  }
  for (const name of ['application', 'browser', 'api', 'infrastructure']) {
    assert.equal(ci.jobs[name].permissions?.['id-token'], undefined, 'untrusted jobs have no OIDC')
  }
  const infra = workflows['infra.yml']
  assert.deepEqual(Object.keys(infra.on), ['workflow_dispatch'], 'infra dispatch only')
  assert.deepEqual(infra.on.workflow_dispatch.inputs.operation.options, ['plan', 'apply'])
  assert.equal(infra.on.workflow_dispatch.inputs.operation.default, 'plan')
  assert.equal(infra.jobs.staging.environment, 'staging-infrastructure')
  assert.equal(infra.jobs.staging.permissions['id-token'], 'write')
  assert.equal(infra.concurrency['cancel-in-progress'], false, 'do not interrupt migrations/deployments')
  const guard = infra.jobs.staging.steps[0].run
  assert.match(guard, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(guard, /test "\$ENABLED" = true/)
  const apply = infra.jobs.staging.steps.find(step => step.name === 'Apply staging foundation')
  assert.equal(apply.if, "${{ inputs.operation == 'apply' }}", 'plan cannot apply')
  const staging = workflows['staging.yml']
  assert.deepEqual(Object.keys(staging.on), ['workflow_dispatch'])
  assert.equal(staging.concurrency.group, infra.concurrency.group, 'serialize all staging changes')
  assert.equal(staging.concurrency['cancel-in-progress'], false)
  assert.equal(staging.jobs.build.permissions?.['id-token'], undefined)
  assert.match(staging.jobs.build.steps[0].run, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(staging.jobs.build.steps[0].run, /head_sha=\$SOURCE_SHA&event=push/)
  assert.match(staging.jobs.build.steps[0].run, /\.conclusion == "success"/)
  assert.equal(staging.jobs.staging.needs, 'build')
  assert.equal(staging.jobs.staging.environment, 'staging-infrastructure')
  assert.equal(staging.jobs.staging.permissions['id-token'], 'write')
  for (const job of Object.values(staging.jobs)) assert.equal(job['runs-on'], 'ubuntu-24.04')
  assert.match(staging.jobs.staging.steps[0].run, /test "\$ENABLED" = true/)
  const publish = staging.jobs.staging.steps.find(step => step.name === 'Publish exact image to private ACR')
  assert.match(publish.run, /griplock@%s/)
  const migrationIndex = staging.jobs.staging.steps.findIndex(step => step.name === 'Verify private database and apply schema')
  const deployIndex = staging.jobs.staging.steps.findIndex(step => step.name === 'Release immutable app revision')
  assert.ok(migrationIndex > 0 && deployIndex > migrationIndex, 'verify and migrate before releasing app')
  assert.match(staging.jobs.staging.steps[deployIndex].run, /releaseId="\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT"/)
  assert.match(staging.jobs.staging.steps[deployIndex].run, /identityConfiguration\(process.env\)/)
  assert.equal(staging.jobs.browser.env.IDENTITY_READY, '${{ needs.staging.outputs.identityReady }}')
  for (const name of ['ENTRA_CLIENT_ID', 'ENTRA_AUTHORITY', 'ENTRA_API_SCOPE', 'AUTH_ISSUER',
    'AUTH_AUDIENCE', 'AUTH_JWKS_URL', 'AUTH_REQUIRED_SCOPE']) {
    assert.equal(staging.jobs.staging.steps[deployIndex].env[name], `\${{ vars.${name} }}`)
  }
  assert.equal(staging.jobs.browser.needs, 'staging')
  assert.ok(staging.jobs.browser.steps.some(step => step.run === 'npm run test:staging'))
  const recording = staging.jobs.browser.steps.findIndex(step => step.name === 'Record verified release')
  const verification = staging.jobs.browser.steps.findIndex(step => step.run === 'npm run test:staging')
  assert.ok(recording > verification && verification >= 0, 'record only after deployed tests pass')
  assert.equal(staging.jobs.browser.steps[recording].run, 'node scripts/record-staging-release.mjs')
  const deploy = workflows['deploy.yml']
  assert.deepEqual(Object.keys(deploy.on), ['workflow_dispatch'], 'production never deploys on push')
  assert.equal(deploy.jobs.deploy.needs, 'checks')
  assert.match(deploy.jobs.checks.steps[0].run, /test "\$ACTOR" = "\$OWNER"/)
  assert.match(deploy.jobs.checks.steps[0].run, /test "\$GITHUB_REF" = refs\/heads\/main/)
  const nativeReview = deploy.jobs.checks.steps.find(step => step.name === 'Require native owner review protection')
  assert.match(nativeReview.run, /required_reviewers/)
  assert.match(nativeReview.run, /if \[ "\$protected" != true \]/)
  assert.equal(deploy.jobs.deploy.environment.name, 'github-pages')
  assert.ok(deploy.jobs.checks.steps.some(step => step.run === 'npm run test:e2e'))
}

test('delivery workflows enforce their source-level trust and deployment contracts', () => {
  checkTrustBoundary(sources)
})

test('gates reject real workflow mutations that grant PR OIDC or remove apply protection', () => {
  for (const [file, before, after] of [
    ['ci.yml', '  contents: read', '  contents: read\n  id-token: write'],
    ['infra.yml', "if: ${{ inputs.operation == 'apply' }}", 'if: ${{ always() }}'],
    ['deploy.yml', 'test "$ACTOR" = "$OWNER"', 'echo approval-skipped'],
    ['infra.yml', 'test "$ENABLED" = true', 'echo enabled'],
    ['ci.yml', 'test "$BROWSER" = success', 'echo browser-skipped'],
    ['ci.yml', 'test "$API" = success', 'echo api-skipped'],
    ['staging.yml', '.conclusion == "success"', '.conclusion != "success"'],
    ['staging.yml', 'test "$ENABLED" = true', 'echo enabled'],
    ['staging.yml', 'releaseId="$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"', 'releaseId="constant"'],
    ['ci.yml', 'playwright:v1.60.0-noble', 'playwright:v1.59.0-noble'],
    ['staging.yml', 'run: node scripts/record-staging-release.mjs', 'run: echo release-skipped'],
    ['staging.yml', 'identityConfiguration(process.env)', 'console.log("validation-skipped")'],
    ['deploy.yml', 'if [ "$protected" != true ]', 'if [ false = true ]'],
  ]) {
    assert.ok(sources[file].includes(before), `${file}: mutation must affect actual source`)
    assert.throws(() => checkTrustBoundary({ ...sources, [file]: sources[file].replace(before, after) }))
  }
})
