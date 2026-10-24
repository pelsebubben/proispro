import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { parse } from 'yaml'
import { schemaVersion } from '../../server/migrate.mjs'

const names = ['ci.yml', 'infra.yml', 'prod.yml', 'dev.yml', 'squad-ci.yml']
const sources = Object.fromEntries(await Promise.all(names.map(async name => [
  name, (await readFile(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8')).replaceAll('\r\n','\n'),
])))
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
  const lint = ci.jobs.infrastructure.steps.find(step => step.name === 'Lint delivery workflows')
  const lintedNames = [...lint.run.matchAll(/\.github\/workflows\/([\w-]+\.yml)/g)].map(match => match[1])
  assert.deepEqual(lintedNames.sort(), [...names].sort(), 'lint every supported delivery workflow')
  for (const browser of [ci.jobs.browser, workflows['prod.yml'].jobs.browser]) {
    assert.equal(browser.container, undefined, 'no independently versioned browser container')
    const install = browser.steps.findIndex(step => step.run === 'npm ci')
    const browsers = browser.steps.findIndex(step => step.run === 'npx --no-install playwright install --with-deps chromium')
    const execute = browser.steps.findIndex(step => /^npm run test:(e2e|staging)$/.test(step.run ?? ''))
    assert.ok(install >= 0 && browsers > install && execute > browsers,
      'install the exact locked Playwright browser before executing tests')
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
  assert.equal(infra.jobs.staging.environment, 'prod')
  assert.equal(infra.jobs.staging.permissions['id-token'], 'write')
  assert.equal(infra.concurrency['cancel-in-progress'], false, 'do not interrupt migrations/deployments')
  const guard = infra.jobs.staging.steps[0].run
  assert.match(guard, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(guard, /test "\$ENABLED" = true/)
  const apply = infra.jobs.staging.steps.find(step => step.name === 'Apply staging foundation')
  assert.equal(apply.if, "${{ inputs.operation == 'apply' }}", 'plan cannot apply')
  const staging = workflows['prod.yml']
  assert.deepEqual(Object.keys(staging.on), ['workflow_dispatch', 'workflow_run'])
  assert.deepEqual(staging.on.workflow_run, { workflows: ['Griplock CI'], types: ['completed'], branches: ['main'] })
  assert.equal(staging.env.SOURCE_SHA, '${{ github.event.workflow_run.head_sha || github.sha }}')
  assert.equal(staging.jobs.build.if, "${{ github.event_name == 'workflow_dispatch' || (github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.event == 'push') }}",
    'auto-release only after a successful main push CI run')
  for (const job of [staging.jobs.build, staging.jobs.staging]) {
    const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@'))
    assert.equal(checkout.with.ref, '${{ env.SOURCE_SHA }}', 'release the CI-verified commit, not the latest main')
  }
  assert.equal(staging.concurrency.group, infra.concurrency.group, 'serialize all staging changes')
  assert.equal(staging.concurrency['cancel-in-progress'], false)
  assert.equal(staging.jobs.build.permissions?.['id-token'], undefined)
  assert.match(staging.jobs.build.steps[0].run, /test "\$GITHUB_REF" = refs\/heads\/main/)
  assert.match(staging.jobs.build.steps[0].run, /head_sha=\$SOURCE_SHA&event=push/)
  assert.match(staging.jobs.build.steps[0].run, /\.conclusion == "success"/)
  assert.equal(staging.jobs.staging.needs, 'build')
  assert.equal(staging.jobs.staging.environment, 'prod')
  assert.equal(staging.jobs.staging.permissions['id-token'], 'write')
  for (const job of Object.values(staging.jobs)) assert.equal(job['runs-on'], 'ubuntu-24.04')
  assert.match(staging.jobs.staging.steps[0].run, /test "\$ENABLED" = true/)
  const publish = staging.jobs.staging.steps.find(step => step.name === 'Publish exact image to private ACR')
  assert.match(publish.run, /griplock@%s/)
  const migrationIndex = staging.jobs.staging.steps.findIndex(step => step.name === 'Verify private database and apply schema')
  const deployIndex = staging.jobs.staging.steps.findIndex(step => step.name === 'Release immutable app revision')
  assert.ok(migrationIndex > 0 && deployIndex > migrationIndex, 'verify and migrate before releasing app')
  const schema = staging.jobs.staging.steps[migrationIndex].run
  const backup = schema.indexOf('bash scripts/backup-live-database.sh')
  assert.ok(schema.indexOf('job-griplock-verify') < backup, 'verify before backup')
  assert.ok(backup > 0 && backup < schema.indexOf('job-griplock-migrate\n'), 'back up live data before migrating it')
  assert.ok(schema.indexOf('job-griplock-migrate-dev') > backup)
  assert.match(schema, /git diff --quiet "\$previous" "\$SOURCE_SHA" -- server\/migrations server\/migrate\.mjs/,
    'skip the slow backup only when no schema code changed since the live release')
  assert.equal(staging.jobs.staging.steps.find(step => step.uses?.startsWith('actions/checkout@')).with['fetch-depth'], 0)
  assert.match(staging.jobs.staging.steps[deployIndex].run, /--parameters stage=dev .*postgresAppPassword="\$PG_DEV_APP"/s)
  const dev = workflows['dev.yml']
  assert.deepEqual(Object.keys(dev.on), ['pull_request', 'workflow_dispatch'])
  assert.deepEqual(dev.on.pull_request.types, ['opened', 'synchronize', 'reopened', 'ready_for_review'],
    'making a draft ready starts its dev deployment')
  assert.equal(dev.concurrency, undefined, 'skipped draft jobs must not cancel active deployments')
  assert.deepEqual(dev.jobs.dev.concurrency, { group: 'griplock-dev', 'cancel-in-progress': true })
  assert.deepEqual(Object.keys(dev.jobs), ['dev'])
  assert.equal(dev.jobs.dev.if, "${{ vars.DEV_ENABLED == 'true' && (github.event_name == 'workflow_dispatch' || (github.event.pull_request.draft == false && github.event.pull_request.user.login != 'dependabot[bot]' && github.event.pull_request.head.repo.full_name == github.repository)) }}",
      'draft, Dependabot and fork PRs never receive the dev cloud identity; manual dispatch remains available')
  assert.equal(dev.jobs.dev.environment.name, 'dev')
  assert.equal(dev.jobs.dev.permissions['id-token'], 'write')
  assert.equal(dev.jobs.dev['runs-on'], 'ubuntu-24.04')
  const pdgaStep = dev.jobs.dev.steps.find(step => step.name === 'Configure server-only PDGA dev access')
  assert.equal(pdgaStep.if, "${{ github.event_name == 'workflow_dispatch' && inputs.configure_pdga }}",
    'PDGA secrets only enter an explicitly requested manual dev step, never a PR-triggered deployment')
  assert.deepEqual(pdgaStep.env, { PDGA_USERNAME: '${{ secrets.PDGA_USERNAME }}',
    PDGA_LAYOUT_INDEX_TEMPLATE: '${{ secrets.PDGA_LAYOUT_INDEX_TEMPLATE }}',
    PDGA_EVENT_OVERVIEW_TEMPLATE: '${{ secrets.PDGA_EVENT_OVERVIEW_TEMPLATE }}',
    PDGA_PASSWORD: '${{ secrets.PDGA_PASSWORD }}', EXPECTED_SOURCE_SHA: '${{ env.SOURCE_SHA }}' })
  assert.equal(pdgaStep.run, 'python3 scripts/configure-pdga-dev.py')
  assert.equal(files['dev.yml'].match(/secrets\./g)?.length, 4, 'only protected provider configuration')
  assert.equal(dev.on.workflow_dispatch.inputs.configure_pdga.default, false)
  assert.ok(!/job-griplock-migrate\b(?!-dev)|app-griplock-staging/.test(files['dev.yml']), 'dev never targets live resources')
  assert.equal(staging.jobs.staging.steps[deployIndex].run.match(/releaseId="\$GITHUB_RUN_ID-\$GITHUB_RUN_ATTEMPT"/g)?.length, 2,
    'live and dev app revisions are unique per run attempt')
  assert.match(staging.jobs.staging.steps[deployIndex].run, /identityConfiguration\(process.env\)/)
  assert.match(staging.jobs.staging.steps[deployIndex].run, new RegExp(`\\.schemaVersion == ${schemaVersion}(?!\\d)`),
    'the release waits for the schema version this code was built for')
  assert.equal(staging.jobs.browser.env.IDENTITY_READY, '${{ needs.staging.outputs.identityReady }}')
  for (const name of ['ENTRA_CLIENT_ID', 'ENTRA_AUTHORITY', 'ENTRA_API_SCOPE', 'AUTH_ISSUER',
    'AUTH_AUDIENCE', 'AUTH_JWKS_URL', 'AUTH_REQUIRED_SCOPE']) {
    assert.equal(staging.jobs.staging.steps[deployIndex].env[name], `\${{ vars.${name} }}`)
  }
  assert.deepEqual(staging.jobs.browser.needs, ['staging','dev-provider'])
  const prodPdga=staging.jobs.staging.steps.find(step=>step.name==='Configure production PDGA from protected environment')
  const providerIndex=staging.jobs.staging.steps.indexOf(prodPdga)
  const freshLogin=staging.jobs.staging.steps[providerIndex-1]
  assert.ok(providerIndex>deployIndex,'provision only after the app rollout')
  assert.ok(freshLogin.uses?.startsWith('azure/login@'),'refresh OIDC immediately before protected provider provisioning')
  assert.deepEqual(freshLogin.with,staging.jobs.staging.steps.find(step=>step.uses?.startsWith('azure/login@')).with)
  assert.equal(prodPdga.env.PDGA_STAGE,'prod')
  assert.equal(prodPdga.env.PDGA_PASSWORD,'${{ secrets.PDGA_PASSWORD }}')
  assert.equal(staging.jobs['dev-provider'].environment,'dev')
  assert.equal(staging.jobs['dev-provider'].needs,'staging')
  assert.equal(staging.jobs['dev-provider'].if,"${{ always() && needs.staging.outputs.url != '' }}",
    'restore dev after a completed app rollout even if the independent production provider stage fails')
  assert.equal(staging.jobs['dev-provider'].permissions['id-token'],'write')
  assert.equal(staging.jobs['dev-provider'].steps.find(step=>step.run?.includes('configure-pdga-dev.py')).env.PDGA_STAGE,'dev')
  assert.ok(staging.jobs.browser.steps.some(step => step.run === 'npm run test:staging'))
  const recording = staging.jobs.browser.steps.findIndex(step => step.name === 'Record verified release')
  const verification = staging.jobs.browser.steps.findIndex(step => step.run === 'npm run test:staging')
  assert.ok(recording > verification && verification >= 0, 'record only after deployed tests pass')
  assert.equal(staging.jobs.browser.steps[recording].run, 'node scripts/record-staging-release.mjs')
}

test('delivery workflows enforce their source-level trust and deployment contracts', () => {
  checkTrustBoundary(sources)
})

test('gates reject real workflow mutations that grant PR OIDC or remove apply protection', () => {
  for (const [file, before, after] of [
    ['ci.yml', '  contents: read', '  contents: read\n  id-token: write'],
    ['infra.yml', "if: ${{ inputs.operation == 'apply' }}", 'if: ${{ always() }}'],
    ['infra.yml', 'test "$ENABLED" = true', 'echo enabled'],
    ['ci.yml', 'test "$BROWSER" = success', 'echo browser-skipped'],
    ['ci.yml', 'test "$API" = success', 'echo api-skipped'],
    ['prod.yml', '.conclusion == "success"', '.conclusion != "success"'],
    ['prod.yml', 'test "$ENABLED" = true', 'echo enabled'],
    ['prod.yml', 'releaseId="$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"', 'releaseId="constant"'],
    ['ci.yml', 'npx --no-install playwright install --with-deps chromium', 'npx playwright@1.60.0 install chromium'],
    ['prod.yml', 'npx --no-install playwright install --with-deps chromium', 'echo browser-install-skipped'],
    ['prod.yml', 'run: node scripts/record-staging-release.mjs', 'run: echo release-skipped'],
    ['prod.yml', 'identityConfiguration(process.env)', 'console.log("validation-skipped")'],
    ['ci.yml', '          .github/workflows/dev.yml', '          .github/workflows/deploy.yml'],
    ['dev.yml', ' && (github.event_name', ' || (github.event_name'],
    ['dev.yml', 'github.event.pull_request.draft == false && ', ''],
    ['dev.yml', "github.event.pull_request.user.login != 'dependabot[bot]' && ", ''],
    ['dev.yml', ', ready_for_review', ''],
    ['dev.yml', '    concurrency:', '    ignored-concurrency:'],
    ['dev.yml', 'DEV_MIGRATION: job-griplock-migrate-dev', 'DEV_MIGRATION: job-griplock-migrate'],
    ['prod.yml', "github.event.workflow_run.conclusion == 'success'", "github.event.workflow_run.conclusion != 'cancelled'"],
    ['prod.yml', '          bash scripts/backup-live-database.sh', '          echo backup-skipped'],
    ['prod.yml', '          ref: ${{ env.SOURCE_SHA }}', '          ref: main'],
    ['prod.yml', '-- server/migrations server/migrate.mjs', '-- docs'],
    ['prod.yml', `.schemaVersion == ${schemaVersion}`, `.schemaVersion == ${schemaVersion - 1}`],
    ['dev.yml', "github.event_name == 'workflow_dispatch' && inputs.configure_pdga", 'always()'],
    ['prod.yml', 'provider provisioning\n        uses: azure/login@', 'provider provisioning\n        uses: azure/logout@'],
  ]) {
    assert.ok(sources[file].includes(before), `${file}: mutation must affect actual source`)
    assert.throws(() => checkTrustBoundary({ ...sources, [file]: sources[file].replace(before, after) }), Error, `${file}: ${before}`)
  }
})

test('every release readiness contract expects the current schema version', async () => {
  const migrations = (await readdir(new URL('../../server/migrations/', import.meta.url))).filter(name => name.endsWith('.sql'))
  assert.equal(migrations.length, schemaVersion, 'schemaVersion counts the migration files')
  const stagingSpec = await readFile(new URL('../../tests/staging/staging.spec.ts', import.meta.url), 'utf8')
  assert.match(stagingSpec, new RegExp(`schemaVersion: ${schemaVersion} \\}`), 'the deployed-release browser check')
})

function checkDependencyMaintenance({ node, manifest, lock, docker, workflows, dependabot }) {
  assert.match(node, /^\d+$/)
  assert.equal(manifest.engines.node, `>=${node} <${Number(node) + 1}`, 'declare the selected Node LTS')
  assert.deepEqual(lock.packages[''].engines, manifest.engines, 'lockfile matches the runtime contract')
  assert.match(manifest.devDependencies['@types/node'], new RegExp(`^\\^${node}\\.`), 'types match the runtime')
  assert.deepEqual([...docker.matchAll(/^FROM node:([^\s]+)/gm)].map(match => match[1]),
    [`${node}-bookworm-slim`, `${node}-bookworm-slim`], 'build and runtime use the same LTS')
  for (const [name, workflow] of Object.entries(workflows)) {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses?.startsWith('actions/setup-node@')) {
          assert.equal(String(step.with['node-version']), node, `${name}: matching Node LTS`)
        }
      }
    }
  }
  assert.equal(dependabot.version, 2)
  for (const ecosystem of ['npm', 'github-actions', 'docker']) {
    const update = dependabot.updates.find(item => item['package-ecosystem'] === ecosystem)
    assert.equal(update?.directory, '/')
    assert.equal(update.schedule.interval, 'daily', `${ecosystem}: daily update discovery`)
    assert.ok(update['open-pull-requests-limit'] >= 10, `${ecosystem}: do not stall after five PRs`)
    assert.ok(Object.values(update.groups).some(group => group.patterns.includes('*')),
      `${ecosystem}: group interdependent updates, including majors`)
    const runtimeDependency = ecosystem === 'npm' ? '@types/node' : ecosystem === 'docker' ? 'node' : null
    assert.deepEqual(update.ignore ?? [], runtimeDependency ? [{
      'dependency-name': runtimeDependency, 'update-types': ['version-update:semver-major'],
    }] : [], `${ecosystem}: only coordinated Node LTS major upgrades are manual`)
  }
}

test('dependency maintenance keeps runtime, CI and update coverage aligned', async () => {
  const read = async path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
  const workflows = {}
  for (const name of await readdir(new URL('../../.github/workflows/', import.meta.url))) {
    if (name.endsWith('.yml') && !name.endsWith('.lock.yml')) {
      workflows[name] = parse(await read(`.github/workflows/${name}`))
    }
  }
  const inputs = {
    node: (await read('.nvmrc')).trim(),
    manifest: JSON.parse(await read('package.json')),
    lock: JSON.parse(await read('package-lock.json')),
    docker: await read('Dockerfile'),
    workflows,
    dependabot: parse(await read('.github/dependabot.yml')),
  }
  checkDependencyMaintenance(inputs)
  assert.throws(() => checkDependencyMaintenance({ ...inputs, node: String(Number(inputs.node) - 2) }))
  assert.throws(() => checkDependencyMaintenance({ ...inputs, docker: inputs.docker.replace('FROM node:', 'FROM old-node:') }))
  const stale = structuredClone(inputs)
  stale.dependabot.updates.find(item => item['package-ecosystem'] === 'npm').schedule.interval = 'weekly'
  assert.throws(() => checkDependencyMaintenance(stale))
})
