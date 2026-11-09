import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { setTimeout } from 'node:timers/promises'

const profiles = {
  'general-purpose': { name: 'Standard_D2ads_v5', tier: 'GeneralPurpose' },
  burstable: { name: 'Standard_B2s', tier: 'Burstable' },
}

export function scheduledOperation(env, now = new Date()) {
  const hour = (value, fallback) => {
    const text = value || fallback
    if (!/^(?:[01]?\d|2[0-3])$/.test(text)) throw new Error(`Invalid database schedule hour: ${text}`)
    return Number(text)
  }
  const start = hour(env.DATABASE_START_HOUR, '17')
  const stop = hour(env.DATABASE_STOP_HOUR, '23')
  if (start === stop) throw new Error('Database start and stop hours must differ')
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: env.DATABASE_TIME_ZONE || 'Europe/Oslo', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const current = Number(parts.find(part => part.type === 'hour').value)
  const active = start < stop ? current >= start && current < stop : current >= start || current < stop
  return active ? 'start' : 'stop'
}

export async function databasePower(operation, env, {
  azure = args => JSON.parse(execFileSync('az', [
    'postgres', 'flexible-server', ...args, '--output', 'json', '--only-show-errors',
  ], { encoding: 'utf8', timeout: 1_200_000, stdio: ['ignore', 'pipe', 'inherit'] }) || 'null'),
  sleep = () => setTimeout(10_000),
  now = () => new Date(),
} = {}) {
  if (!['start', 'stop', 'reconcile', 'resize'].includes(operation)) {
    throw new Error(`Unsupported database operation: ${operation}`)
  }
  // Validate the schedule and profile before making any Azure changes.
  if (operation === 'reconcile') operation = scheduledOperation(env, now())
  const profile = env.DATABASE_COMPUTE_PROFILE || 'general-purpose'
  if (!Object.hasOwn(profiles, profile)) throw new Error(`Invalid database compute profile: ${profile}`)
  if (!env.RESOURCE_GROUP || !env.DATABASE_SERVER) throw new Error('RESOURCE_GROUP and DATABASE_SERVER are required')
  const target = ['--resource-group', env.RESOURCE_GROUP, '--name', env.DATABASE_SERVER]
  const show = () => azure(['show', ...target])
  const stable = async () => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const server = show()
      if (['Ready', 'Stopped'].includes(server.state)) return server
      if (!['Starting', 'Stopping', 'Updating'].includes(server.state)) {
        throw new Error(`Unexpected database state: ${server.state}`)
      }
      await sleep()
    }
    throw new Error('Timed out waiting for a stable database state')
  }
  let server = await stable()
  const desired = operation === 'stop' ? 'Stopped' : 'Ready'
  if (server.state !== desired) {
    azure([desired === 'Ready' ? 'start' : 'stop', ...target])
    server = await stable()
    if (server.state !== desired) throw new Error(`Database did not reach ${desired}; observed ${server.state}`)
  }
  if (operation === 'resize') {
    const sku = profiles[profile]
    if (server.sku.name !== sku.name || server.sku.tier !== sku.tier) {
      azure(['update', ...target, '--tier', sku.tier, '--sku-name', sku.name])
      server = await stable()
      if (server.state !== 'Ready' || server.sku.name !== sku.name || server.sku.tier !== sku.tier) {
        throw new Error(`Database resize did not reach ${sku.tier}/${sku.name} in Ready state`)
      }
    }
  }
  return `Database ${env.DATABASE_SERVER}: ${server.state}, ${server.sku.tier}/${server.sku.name}`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const message = await databasePower(process.argv[2], process.env)
    console.log(message)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`)
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
}
