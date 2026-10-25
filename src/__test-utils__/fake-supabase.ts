/**
 * Minimal in-memory stand-in for the supabase-js query builder, for tests that need real
 * row state across several queries (#452). Each query runs atomically when awaited, after a
 * macrotask hop, so concurrent callers interleave between queries the way they would against
 * Postgres - and a conditional UPDATE behaves like one under row locks (the second one sees the
 * first one's result).
 *
 * Supports: select / insert / update, eq, in, order, limit, single, maybeSingle, and
 * `col->>key` JSON paths in filters. Emulates the xero_payments_one_live_early_payoff index.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>

const LIVE = ['staged', 'pending', 'processing', 'synced']

let idCounter = 0
const nextId = (table: string) => `${table}-${++idCounter}`

function getValue(row: Row, key: string): unknown {
  if (key.includes('->>')) {
    const [col, path] = key.split('->>')
    const v = row[col]?.[path]
    return v === undefined || v === null ? null : String(v)
  }
  return row[key]
}

export function createFakeSupabase(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {}
  for (const [t, rows] of Object.entries(seed)) tables[t] = rows.map(r => ({ ...r }))
  const table = (name: string) => (tables[name] ||= [])

  function violatesUnique(name: string, candidate: Row, ignoreId?: string): boolean {
    if (name !== 'xero_payments') return false
    const isLivePayoff = (r: Row) =>
      r.payment_type === 'full' && String(r.staging_metadata?.early_payoff) === 'true' && LIVE.includes(r.sync_status)
    if (!isLivePayoff(candidate)) return false
    return table(name).some(r => r.id !== ignoreId && r.xero_invoice_id === candidate.xero_invoice_id && isLivePayoff(r))
  }

  function builder(name: string) {
    let op: 'select' | 'insert' | 'update' = 'select'
    let payload: Row | Row[] | null = null
    let returning = false
    let mode: 'many' | 'single' | 'maybeSingle' = 'many'
    let limitN: number | null = null
    let orderBy: string | null = null
    const filters: Array<(r: Row) => boolean> = []

    const run = () => {
      const rows = table(name)
      if (op === 'insert') {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[]
        const inserted: Row[] = []
        for (const p of list) {
          const row = { id: nextId(name), ...p }
          if (violatesUnique(name, row)) {
            return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "xero_payments_one_live_early_payoff"' } }
          }
          rows.push(row)
          inserted.push({ ...row })
        }
        return shape(inserted)
      }
      let matched = rows.filter(r => filters.every(f => f(r)))
      if (op === 'update') {
        for (const r of matched) {
          const next = { ...r, ...(payload as Row) }
          if (violatesUnique(name, next, r.id)) {
            return { data: null, error: { code: '23505', message: 'duplicate key' } }
          }
        }
        matched.forEach(r => Object.assign(r, payload))
        return returning ? shape(matched.map(r => ({ ...r }))) : { data: null, error: null }
      }
      if (orderBy) matched = [...matched].sort((a, b) => (a[orderBy!] ?? 0) - (b[orderBy!] ?? 0))
      if (limitN !== null) matched = matched.slice(0, limitN)
      return shape(matched.map(r => ({ ...r })))
    }

    const shape = (rows: Row[]) => {
      if (mode === 'single') {
        return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116', message: `expected 1 row, got ${rows.length}` } }
      }
      if (mode === 'maybeSingle') {
        return rows.length <= 1 ? { data: rows[0] ?? null, error: null } : { data: null, error: { message: 'multiple rows' } }
      }
      return { data: rows, error: null }
    }

    const q: any = {
      select: () => { if (op !== 'select') returning = true; return q },
      insert: (v: Row | Row[]) => { op = 'insert'; payload = v; return q },
      update: (v: Row) => { op = 'update'; payload = v; return q },
      eq: (k: string, v: unknown) => {
        filters.push(r => {
          const val = getValue(r, k)
          return k.includes('->>') ? val === String(v) : val === v
        })
        return q
      },
      in: (k: string, vs: unknown[]) => { filters.push(r => vs.includes(getValue(r, k))); return q },
      lte: (k: string, v: any) => { filters.push(r => r[k] <= v); return q },
      order: (k: string) => { orderBy = k; return q },
      limit: (n: number) => { limitN = n; return q },
      single: () => { mode = 'single'; return q },
      maybeSingle: () => { mode = 'maybeSingle'; return q },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        new Promise(r => setTimeout(r, 0)).then(run).then(resolve, reject)
    }
    return q
  }

  return {
    tables,
    from: (name: string) => builder(name),
    rows: (name: string) => table(name)
  }
}
