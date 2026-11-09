import assert from 'node:assert/strict'
import test from 'node:test'
import { migrate } from '../../server/migrate.mjs'

const password = 'x'.repeat(32)
const unreachable = { connect: () => { throw new Error('must validate before connecting') } }

test('migration rejects runtime role names that could escape identifier quoting or reuse admin', async () => {
  for (const role of ['griplock_admin', 'postgres', 'griplock_app; DROP TABLE owned_discs', 'Griplock_App',
    'griplock_', 'griplock_app"', `griplock_${'a'.repeat(41)}`]) {
    await assert.rejects(migrate(unreachable, password, role), /Invalid runtime role name/, role)
  }
  await assert.rejects(migrate(unreachable, 'short', 'griplock_dev_app'), /at least 32 characters/)
})

test('migration accepts the live and dev runtime roles', async () => {
  for (const role of [undefined, 'griplock_app', 'griplock_dev_app']) {
    await assert.rejects(migrate(unreachable, password, role), /must validate before connecting/)
  }
})
