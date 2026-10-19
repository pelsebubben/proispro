import * as fs from 'fs'
import * as path from 'path'
import { parseArgs, getString } from './args'
import { createPool } from './db'
import { buildOwnerResolver, OwnerResolver } from './ownerMap'
import { TABLE_MAPPINGS, stampOwner } from './mapping'
import { ownerInClause } from './merge'
import { Backup } from './types'

// Prints source (backup) vs target (Azure SQL) row counts per entity. When an
// owner mapping is supplied the target counts are scoped to exactly those
// owners (apples-to-apples with what was imported); otherwise target counts are
// whole-table and clearly labelled as UNSCOPED.
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const file = path.resolve(
    getString(args, 'in') ?? getString(args, 'file') ?? 'proispro-backup.json'
  )
  if (!fs.existsSync(file)) {
    throw new Error(`Backup file not found: ${file}. Run \`npm run export\` first.`)
  }
  const backup = JSON.parse(fs.readFileSync(file, 'utf8')) as Backup

  let resolver: OwnerResolver | undefined
  try {
    resolver = buildOwnerResolver(args)
  } catch {
    console.warn('No --owner/--owner-map supplied: target counts will be UNSCOPED.\n')
  }

  const owners = new Set<string>()
  const backupCounts = new Map<string, number>()
  for (const m of TABLE_MAPPINGS) {
    const rows = backup.tables[m.entity] ?? []
    backupCounts.set(m.entity, rows.length)
    if (resolver) {
      for (const r of rows) {
        try {
          owners.add(stampOwner(resolver, r))
        } catch {
          // Unmappable row: leave out of scoping; count comparison will surface it.
        }
      }
    }
  }

  const ownerList = [...owners]
  const pool = await createPool()
  let allOk = true
  try {
    console.log(
      `Verify: backup=${path.basename(file)}  scope=${
        ownerList.length ? ownerList.join(',') : 'UNSCOPED'
      }\n`
    )
    for (const m of TABLE_MAPPINGS) {
      const req = pool.request()
      const where = resolver ? ownerInClause(req, ownerList) : ''
      const res = await req.query(`SELECT COUNT(*) AS n FROM ${m.target}${where};`)
      const target = res.recordset[0].n as number
      const src = backupCounts.get(m.entity) ?? 0
      const ok = target === src
      if (!ok) allOk = false
      console.log(`  ${ok ? 'OK ' : '!! '}${m.target}: source=${src} target=${target}`)
    }
    console.log(
      allOk
        ? '\n=> all table counts match. Round-trip verified.'
        : '\n=> MISMATCH — see rows marked !! above.'
    )
  } finally {
    await pool.close()
  }
  if (!allOk) process.exit(2)
}

main().catch((err) => {
  console.error('\nVerify error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
