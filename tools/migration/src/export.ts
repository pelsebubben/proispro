import * as fs from 'fs'
import * as path from 'path'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { requireEnv } from './env'
import { parseArgs, getString } from './args'
import { Backup, ENTITY_KEYS, SOURCE_TABLES, SourceRow, emptyBackup } from './types'

const PAGE_SIZE = 1000

// Pulls every row of a table, paging through Supabase's 1000-row ceiling.
async function fetchAll(
  client: SupabaseClient,
  table: string
): Promise<SourceRow[]> {
  const rows: SourceRow[] = []
  let from = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await client.from(table).select('*').range(from, to)
    if (error) {
      // A missing table should not abort the whole export — warn and skip.
      const msg = error.message || String(error)
      if (/relation .* does not exist|could not find the table|does not exist/i.test(msg)) {
        console.warn(`  ! table "${table}" not found in source — skipping (0 rows).`)
        return rows
      }
      throw new Error(`Export failed reading "${table}": ${msg}`)
    }
    const batch = (data ?? []) as SourceRow[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return rows
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const outPath = path.resolve(getString(args, 'out') ?? 'proispro-backup.json')

  const url = requireEnv('SUPABASE_URL')
  const key = requireEnv('SUPABASE_KEY')
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const backup: Backup = emptyBackup()
  const userIds = new Set<string>()

  console.log(`Exporting from ${url}`)
  for (const entity of ENTITY_KEYS) {
    const table = SOURCE_TABLES[entity]
    process.stdout.write(`  - ${entity} (${table}) ... `)
    const rows = await fetchAll(client, table)
    backup.tables[entity] = rows
    for (const r of rows) {
      if (r.user_id != null) userIds.add(String(r.user_id))
    }
    console.log(`${rows.length} rows`)
  }

  // collection_discs has no user_id in the source. Stamp each row with the
  // owner of its parent collection so ownership survives into the backup.
  stampCollectionDiscOwners(backup)
  for (const r of backup.tables.collectionDiscs) {
    if (r.user_id != null) userIds.add(String(r.user_id))
  }

  backup.userIds = [...userIds].sort()
  backup.exportedAt = Date.now()

  fs.writeFileSync(outPath, JSON.stringify(backup, null, 2), 'utf8')

  console.log('')
  console.log(`Wrote backup -> ${outPath}`)
  console.log(`Distinct source user_ids (${backup.userIds.length}):`)
  for (const uid of backup.userIds) console.log(`  ${uid}`)
  console.log('')
  console.log('Next: build an owner-map.json ({ "<user_id>": "<entra_oid>" }) or')
  console.log('use --owner <entra_oid> for a single-user import. See README.md.')
}

function stampCollectionDiscOwners(backup: Backup): void {
  const owner = new Map<string, string>()
  for (const c of backup.tables.collections) {
    if (c.id != null && c.user_id != null) {
      owner.set(String(c.id), String(c.user_id))
    }
  }
  let unresolved = 0
  for (const cd of backup.tables.collectionDiscs) {
    if (cd.user_id != null) continue
    const uid = cd.collection_id != null ? owner.get(String(cd.collection_id)) : undefined
    if (uid) {
      cd.user_id = uid
    } else {
      unresolved++
    }
  }
  if (unresolved > 0) {
    console.warn(
      `  ! ${unresolved} collection_discs row(s) could not be matched to a parent ` +
        `collection owner; they will require --owner at import time.`
    )
  }
}

main().catch((err) => {
  console.error('\nExport error:', err instanceof Error ? err.message : err)
  process.exit(1)
})
