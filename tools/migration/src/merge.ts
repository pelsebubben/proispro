import * as sql from 'mssql'
import { TableMapping } from './mapping'

// Builds the idempotent MERGE statement for a table mapping. Shared by both
// the pooled and transaction-scoped execution paths so the SQL never drifts.
export function buildMergeStatement(m: TableMapping): string {
  const srcCols = m.columns.map((c) => `@${c.name} AS [${c.name}]`).join(', ')
  const onClause = m.pk.map((k) => `tgt.[${k}] = src.[${k}]`).join(' AND ')
  const nonPk = m.columns.filter((c) => !m.pk.includes(c.name))
  const updateSet = nonPk.map((c) => `tgt.[${c.name}] = src.[${c.name}]`).join(', ')
  const insertCols = m.columns.map((c) => `[${c.name}]`).join(', ')
  const insertVals = m.columns.map((c) => `src.[${c.name}]`).join(', ')
  const whenMatched = updateSet ? `WHEN MATCHED THEN UPDATE SET ${updateSet}` : ''
  return (
    `MERGE ${m.target} AS tgt\n` +
    `USING (SELECT ${srcCols}) AS src\n` +
    `ON ${onClause}\n` +
    `${whenMatched}\n` +
    `WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals});`
  )
}

export function bindRowInputs(
  req: sql.Request,
  m: TableMapping,
  values: Record<string, unknown>
): void {
  for (const col of m.columns) {
    req.input(col.name, col.type, values[col.name] ?? null)
  }
}

export async function upsertRow(
  req: sql.Request,
  m: TableMapping,
  values: Record<string, unknown>
): Promise<void> {
  bindRowInputs(req, m, values)
  await req.query(buildMergeStatement(m))
}

// Builds a scoped `ownerId IN (...)` predicate, binding each owner as a
// parameter on the given request. Returns '' when there are no owners.
export function ownerInClause(req: sql.Request, owners: string[], prefix = 'o'): string {
  if (owners.length === 0) return ''
  const params = owners.map((o, i) => {
    const name = `${prefix}${i}`
    req.input(name, sql.NVarChar(100), o)
    return `@${name}`
  })
  return ` WHERE [ownerId] IN (${params.join(', ')})`
}
