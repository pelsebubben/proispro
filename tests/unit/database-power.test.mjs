import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parse } from 'yaml'
import { databasePower, scheduledOperation } from '../../scripts/database-power.mjs'

const env = { RESOURCE_GROUP: 'test-group', DATABASE_SERVER: 'test-server' }
const sku = { name: 'Standard_D2ads_v5', tier: 'GeneralPurpose' }
const burstable = { name: 'Standard_B2s', tier: 'Burstable' }
const state = (state, size = sku) => ({ state, sku: size })
function azureStub(states) {
  const calls = []
  return {
    calls,
    azure(args) {
      calls.push(args)
      if (args[0] === 'show') {
        assert.ok(states.length, 'unexpected additional database read')
        return states.shift()
      }
    },
    sleep: async () => {},
  }
}

test('daily evening window follows Oslo winter/summer time and exact boundaries', () => {
  for (const [timestamp, expected] of [
    ['2026-11-09T15:59:59Z', 'stop'], ['2026-11-09T16:00:00Z', 'start'],
    ['2026-11-09T21:59:59Z', 'start'], ['2026-11-09T22:00:00Z', 'stop'],
    ['2026-07-12T14:59:59Z', 'stop'], ['2026-07-12T15:00:00Z', 'start'],
    ['2026-07-12T21:00:00Z', 'stop'],
  ]) assert.equal(scheduledOperation(env, new Date(timestamp)), expected, timestamp)
})

test('custom overnight windows include midnight and support UTC', () => {
  const overnight = { DATABASE_TIME_ZONE: 'UTC', DATABASE_START_HOUR: '22', DATABASE_STOP_HOUR: '06' }
  for (const [hour, expected] of [['21', 'stop'], ['22', 'start'], ['00', 'start'], ['05', 'start'], ['06', 'stop']]) {
    assert.equal(scheduledOperation(overnight, new Date(`2026-11-09T${hour}:00:00Z`)), expected)
  }
})

test('invalid schedule, profile, target and operation fail before changing Azure', async () => {
  for (const changes of [
    { DATABASE_START_HOUR: '24' }, { DATABASE_STOP_HOUR: '-1' },
    { DATABASE_START_HOUR: '17.5' }, { DATABASE_STOP_HOUR: '17' }, { DATABASE_TIME_ZONE: 'Invalid/Zone' },
    { DATABASE_COMPUTE_PROFILE: 'expensive' }, { DATABASE_SERVER: '' },
  ]) {
    const stub = azureStub([])
    await assert.rejects(databasePower('reconcile', { ...env, ...changes }, stub))
    assert.deepEqual(stub.calls, [])
  }
  await assert.rejects(databasePower('delete', env), /Unsupported database operation/)
})

test('start and stop are idempotent and always target the configured server', async () => {
  for (const [operation, initial] of [['start', 'Ready'], ['stop', 'Stopped']]) {
    const stub = azureStub([state(initial)])
    const message = await databasePower(operation, env, stub)
    assert.deepEqual(stub.calls, [['show', '--resource-group', 'test-group', '--name', 'test-server']])
    assert.equal(message, `Database test-server: ${initial}, GeneralPurpose/Standard_D2ads_v5`)
  }
})

test('start waits through an existing stop and verifies completion', async () => {
  const stub = azureStub(['Stopping', 'Stopped', 'Starting', 'Ready'].map(value => state(value)))
  await databasePower('start', env, stub)
  assert.deepEqual(stub.calls.map(call => call[0]), ['show', 'show', 'start', 'show', 'show'])
})

test('reconciliation uses execution time, not the original queued schedule event', async () => {
  const stub = azureStub([state('Ready'), state('Stopping'), state('Stopped')])
  await databasePower('reconcile', env, { ...stub, now: () => new Date('2026-11-09T22:47:00Z') })
  assert.deepEqual(stub.calls.map(call => call[0]), ['show', 'stop', 'show', 'show'])
})

test('resize wakes a stopped server and verifies the exact burstable SKU', async () => {
  const stub = azureStub([state('Stopped'), state('Ready'), state('Updating'), state('Ready', burstable)])
  await databasePower('resize', { ...env, DATABASE_COMPUTE_PROFILE: 'burstable' }, stub)
  assert.deepEqual(stub.calls.filter(call => call[0] !== 'show'), [
    ['start', '--resource-group', 'test-group', '--name', 'test-server'],
    ['update', '--resource-group', 'test-group', '--name', 'test-server', '--tier', 'Burstable', '--sku-name', 'Standard_B2s'],
  ])
})

test('same-size resize is a no-op and general-purpose rollback uses the original SKU', async () => {
  const unchanged = azureStub([state('Ready', burstable)])
  await databasePower('resize', { ...env, DATABASE_COMPUTE_PROFILE: 'burstable' }, unchanged)
  assert.equal(unchanged.calls.length, 1)
  const rollback = azureStub([state('Ready', burstable), state('Ready')])
  await databasePower('resize', env, rollback)
  assert.deepEqual(rollback.calls[1].slice(-4), ['--tier', 'GeneralPurpose', '--sku-name', 'Standard_D2ads_v5'])
})

test('capacity errors, wrong final state/SKU, failed states and polling timeouts fail visibly', async () => {
  const error = new Error('RegionalAllocationFailed')
  const capacity = azureStub([state('Ready')])
  const azure = args => {
    if (args[0] === 'update') throw error
    return capacity.azure(args)
  }
  await assert.rejects(databasePower('resize', { ...env, DATABASE_COMPUTE_PROFILE: 'burstable' },
    { ...capacity, azure }), error)
  await assert.rejects(databasePower('start', env, azureStub([state('Stopped'), state('Stopped')])), /did not reach Ready/)
  await assert.rejects(databasePower('resize', { ...env, DATABASE_COMPUTE_PROFILE: 'burstable' },
    azureStub([state('Ready'), state('Ready')])), /resize did not reach/)
  await assert.rejects(databasePower('start', env, azureStub([state('Disabled')])), /Unexpected database state/)
  await assert.rejects(databasePower('start', env, azureStub(Array.from({ length: 120 }, () => state('Starting')))),
    /Timed out/)
})

const workflowNames = ['database-power', 'prod', 'dev', 'infra']
const workflows = Object.fromEntries(await Promise.all(workflowNames.map(async name => [
  name, parse(await readFile(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8')),
])))
function checkPowerContract(power) {
  assert.deepEqual(Object.keys(power.on), ['schedule', 'workflow_dispatch'])
  assert.equal(power.jobs.database.if, "${{ github.ref == 'refs/heads/main' && (github.event_name == 'workflow_dispatch' || vars.DATABASE_SCHEDULE_ENABLED == 'true') }}")
  assert.deepEqual(power.concurrency, { group: 'griplock-staging-release', 'cancel-in-progress': false, queue: 'max' })
  assert.equal(power.jobs.database.environment, 'prod')
  assert.equal(power.jobs.database.permissions['id-token'], 'write')
  assert.equal(power.jobs.database.steps[0].run, 'test "$ENABLED" = true')
  assert.equal(power.jobs.database.steps[0].env.ENABLED, '${{ vars.INFRA_ENABLED }}')
  assert.equal(power.jobs.database.steps[1].if, "${{ env.OPERATION == 'reconcile' }}")
  assert.equal(power.jobs.database.steps[1].run, 'test "$ENABLED" = true')
  assert.equal(power.jobs.database.steps[1].env.ENABLED, '${{ vars.DATABASE_SCHEDULE_ENABLED }}')
  assert.equal(power.jobs.database.env.DATABASE_COMPUTE_PROFILE, "${{ vars.DATABASE_COMPUTE_PROFILE || 'general-purpose' }}")
  assert.deepEqual(power.on.workflow_dispatch.inputs.operation.options, ['reconcile', 'start', 'stop', 'resize'])
  assert.equal(power.on.schedule[0].cron, '17,47 * * * *')
}

test('power controls require opt-in and share a non-cancelling queue with every deployment', async () => {
  checkPowerContract(workflows['database-power'])
  assert.deepEqual(workflows.prod.concurrency, workflows['database-power'].concurrency)
  assert.deepEqual(workflows.infra.concurrency, workflows.prod.concurrency)
  assert.deepEqual(workflows.dev.jobs.dev.concurrency, workflows.prod.concurrency)
  const release = workflows.prod.jobs.staging
  const apply = release.steps.find(step => step.name === 'Validate and apply private staging infrastructure').run
  assert.ok(apply.indexOf('node scripts/database-power.mjs start') < apply.indexOf('az deployment group validate'))
  assert.match(apply, /if \[ -n "\$existing" \]; then\s+node scripts\/database-power.mjs start/)
  assert.equal(apply.match(/databaseComputeProfile="\$DATABASE_COMPUTE_PROFILE"/g)?.length, 3)
  assert.equal(release.env.DATABASE_COMPUTE_PROFILE, "${{ vars.DATABASE_COMPUTE_PROFILE || 'general-purpose' }}")
  const devSchema = workflows.dev.jobs.dev.steps.find(step => step.name === 'Apply branch schema to dev database').run
  assert.ok(devSchema.indexOf('node scripts/database-power.mjs start') < devSchema.indexOf('bash scripts/run-staging-job.sh'))
  const bicep = await readFile(new URL('../../infra/staging.bicep', import.meta.url), 'utf8')
  assert.match(bicep, /burstable: \{ name: 'Standard_B2s', tier: 'Burstable' \}/)
  assert.match(bicep, /sku: databaseSkus\[databaseComputeProfile\]/)
  assert.match(bicep, /param databaseComputeProfile string = 'general-purpose'/)
})

test('power workflow assertions reject removed safety boundaries', () => {
  for (const mutate of [
    workflow => { workflow.jobs.database.if = "${{ github.ref == 'refs/heads/main' }}" },
    workflow => { workflow.concurrency['cancel-in-progress'] = true },
    workflow => { delete workflow.concurrency.queue },
    workflow => { workflow.jobs.database.environment = 'dev' },
    workflow => { workflow.jobs.database.steps[0].run = 'true' },
  ]) {
    const changed = structuredClone(workflows['database-power'])
    mutate(changed)
    assert.throws(() => checkPowerContract(changed))
  }
})
