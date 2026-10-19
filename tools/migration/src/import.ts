import * as fs from 'fs'
import * as path from 'path'
import * as sql from 'mssql'
import { parseArgs, getString, getFlag } from './args'
import { buildOwnerResolver } from './ownerMap'
import { createPool } from './db'
import { TABLE_MAPPINGS, TableMapping, stampOwner } from './mapping'
import { upsertRow, ownerInClause } from './merge'
import { Backup, BACKUP_VERSION } from './types'

function loadBackup(file: string): Backup {
  if (!fs.existsSync(file)) {
    throw new Error(`Backup file not found: ${file}. Run \`npm run export\` first.`)
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Backup
  if (parsed.version !== BACKUP_VERSION) {
    console.warn(
      `  ! backup version is ${parsed.version}, expected ${BACKUP_VERSION}. Continuing.`
    )
  }
  return parsed
}

interface PlannedTable {
  m: TableMapping
  rows: Record<string, unknown>[]
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const file = path.resolve(
    getString(args, 'in') ?? getString(args, 'file') ?? 'proispro-backup.json'
  )
  const fresh = getFlag(args, 'fresh')
  const dryRun = getFlag(args, 'dry-run')
  const alsoVerify = getFlag(args, 'verify')

  const backup = loadBackup(file)
  const resolver = buildOwnerResolver(args)

  // Pre-resolve every row's ownerId first. If ANY row is unmapped we abort
  // BEFORE touching the database — never a partial, half-owned import.
  const planned: PlannedTable[] = []
  const ownersTouched = new Set<string>()
  let total = 0
  for (const m of TABLE_MAPPINGS) {
    const src = backup.tables[m.entity] ?? []
    const rows = src.map((r) => {
      const ownerId = stampOwner(resolver, r)
      ownersTouched.add(ownerId)
      return m.toRow(r, ownerId)
    })
    planned.push({ m, rows })
    total += rows.length
  }

  console.log(`Backup:   ${file}`)
  console.log(`Rows:     ${total} across ${TABLE_MAPPINGS.length} tables`)
  console.log(`Owners:   ${[...ownersTouched].join(', ') || '(none)'}`)
  console.log(`Mode:     ${fresh ? 'FRESH (delete owners then load)' : 'UPSERT (MERGE)'}`)

  if (dryRun) {
    console.log('\n--dry-run: resolved all owners and built row set; no DB writes.')
    for (const { m, rows } of planned) console.log(`  ${m.target}: ${rows.length}`)
    return
  }

  const owners = [...ownersTouched]
  const pool = await createPool()
  try {
    for (const { m, rows } of planned) {
      process.stdout.write(`  ${m.target} ... `)
      const tx = new sql.Transaction(pool)
      await tx.begin()
      try {
        if (fresh) {
          const delReq = new sql.Request(tx)
          const where = ownerInClause(delReq, owners)
          if (where) await delReq.query(`DELETE FROM ${m.target}${where};`)
        }
        for (const values of rows) {
          await upsertRow(new sql.Request(tx), m, values)
        }
        await tx.commit()
        console.log(`${rows.length} rows ${fresh ? 'loaded' : 'upserted'}`)
      } catch (e) {
        await tx.rollback()
        throw e
      }
    }
    console.log('\nImport complete.')

    if (alsoVerify) {
      console.log('\nVerification (backup vs target):')
      await printCounts(pool, planned, owners)
    }
  } finally {
    await pool.close()
  }
}

async function printCounts(
  pool: sql.ConnectionPool,
  planned: PlannedTable[],
  owners: string[]
): Promise<void> {
  let allOk = true
  for (const { m, rows } of planned) {
    const req = pool.request()
    const where = ownerInClause(req, owners)
    const res = await req.query(`SELECT COUNT(*) AS n FROM ${m.target}${where};`)
    const target = res.recordset[0].n as number
    const ok = target === rows.length
    if (!ok) allOk = false
    console.log(`  ${ok ? 'OK ' : '!! '}${m.target}: backup=${rows.length} target=${target}`)
  }
  console.log(allOk ? '  => all table counts match.' : '  => MISMATCH — investigate above.')
}

main().catch((err) => {
  console.error('\nImport error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
