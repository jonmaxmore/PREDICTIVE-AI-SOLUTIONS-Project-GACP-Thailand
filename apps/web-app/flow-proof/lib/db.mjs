/**
 * Raw-SQL DB snapshot/diff layer, deliberately NOT going through Prisma.
 * This harness needs to prove real Postgres row changes independent of
 * whatever ORM/engine state the backend is in — using `psql` directly means
 * the DB-diff layer works even when the app's Prisma client cannot be
 * generated (see evidence/flow-proof/<date>/report.html "infra blockers"
 * section for why that matters in this sandbox).
 *
 * Table names are NOT accepted from arbitrary input — callers pass one of
 * the names in ALLOWED_TABLES (sourced from the actual @@map() values in
 * apps/backend/prisma/schema/*.prisma, cited per table below) so this never
 * builds SQL from an untrusted string.
 */
import { spawnSync } from 'node:child_process';

/**
 * apps/backend/prisma/schema/application.prisma:227 (@@map("applications"))
 * apps/backend/prisma/schema/billing.prisma:1255,1310 (@@map("checkout_orders"))
 * apps/backend/prisma/schema/audit.prisma:67 (@@map("audit_logs"))
 * apps/backend/prisma/schema/certification.prisma:142 (@@map("certificates"))
 */
export const ALLOWED_TABLES = new Set(['applications', 'checkout_orders', 'audit_logs', 'certificates']);

/** Conservative allowlist for values interpolated into a WHERE clause (UUIDs / application numbers / short codes only). */
const SAFE_LITERAL_RE = /^[A-Za-z0-9_-]{1,128}$/;

function sqlLiteral(value) {
  if (typeof value !== 'string' || !SAFE_LITERAL_RE.test(value)) {
    throw new Error(`db.mjs: refusing to interpolate unsafe SQL literal: ${JSON.stringify(value)}`);
  }
  return `'${value}'`;
}

/**
 * Column-name validation only — NOT a claim about casing convention. This
 * schema mixes both: fields with an explicit `@map("snake_case")` are
 * snake_case in Postgres, everything else keeps Prisma's own camelCase field
 * name as the literal (quoted) column name (e.g. CheckoutOrder.applicationId
 * has no @map -> real column is `"applicationId"`, but
 * CheckoutOrder.platformFeeNet -> `platform_fee_net`). Every identifier this
 * module builds is therefore double-quoted so either casing round-trips
 * correctly, and callers pass the exact real column name (cited at the call
 * site) rather than this module guessing a convention.
 */
function ident(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`db.mjs: unsafe identifier: ${name}`);
  return `"${name}"`;
}

/**
 * Prisma's DATABASE_URL carries a `schema=` query param that is a Prisma-only
 * convention, not a libpq one — plain `psql` rejects it outright ("invalid
 * URI query parameter"). Strip query params for the raw-SQL connection here;
 * this harness only ever reads from/writes to `public` (the DB's default
 * search_path), same as the rest of this repo's non-Prisma tooling.
 */
function toLibpqUrl(databaseUrl) {
  const u = new URL(databaseUrl);
  u.search = '';
  return u.toString();
}

function psqlJson(databaseUrl, sql) {
  const res = spawnSync(
    'psql',
    [toLibpqUrl(databaseUrl), '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { encoding: 'utf8', timeout: 15_000 },
  );
  if (res.error) {
    throw new Error(`db.mjs: psql spawn failed: ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(`db.mjs: psql exited ${res.status}: ${(res.stderr || res.stdout || '').trim().slice(0, 500)}`);
  }
  const out = res.stdout.trim();
  return out ? JSON.parse(out) : [];
}

/** Snapshot rows matching every {column, value} pair in `whereList` (AND-ed), as plain JSON objects. */
export function snapshotTableMulti(databaseUrl, table, whereList) {
  if (!ALLOWED_TABLES.has(table)) throw new Error(`db.mjs: table not in ALLOWED_TABLES: ${table}`);
  const clause = whereList.map(({ column, value }) => `${ident(column)} = ${sqlLiteral(value)}`).join(' AND ');
  const sql = `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT * FROM ${ident(table)} WHERE ${clause} ORDER BY ${ident('id')}) t;`;
  return psqlJson(databaseUrl, sql);
}

/** Snapshot every row currently matching `whereColumn = whereValue` in `table`, as plain JSON objects. */
export function snapshotTable(databaseUrl, table, whereColumn, whereValue) {
  return snapshotTableMulti(databaseUrl, table, [{ column: whereColumn, value: whereValue }]);
}

/** Same as snapshotTable but with no WHERE — bounded by LIMIT for tables with no natural filter yet available (e.g. audit_logs before an applicationId exists). */
export function snapshotTableRecent(databaseUrl, table, limit) {
  if (!ALLOWED_TABLES.has(table)) throw new Error(`db.mjs: table not in ALLOWED_TABLES: ${table}`);
  const n = Number.isInteger(limit) && limit > 0 ? limit : 20;
  const sql = `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (SELECT * FROM ${ident(table)} ORDER BY ${ident('id')} DESC LIMIT ${n}) t;`;
  return psqlJson(databaseUrl, sql);
}

/** Row-level diff by `id`, reporting exactly which columns changed. */
export function diffRows(before, after) {
  const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
  const b = byId(before);
  const a = byId(after);
  const added = [];
  const removed = [];
  const changed = [];
  for (const [id, row] of a) {
    if (!b.has(id)) { added.push(row); continue; }
    const prev = b.get(id);
    const fields = {};
    for (const key of new Set([...Object.keys(prev), ...Object.keys(row)])) {
      const pv = JSON.stringify(prev[key]);
      const av = JSON.stringify(row[key]);
      if (pv !== av) fields[key] = { from: prev[key], to: row[key] };
    }
    if (Object.keys(fields).length > 0) changed.push({ id, fields });
  }
  for (const [id, row] of b) {
    if (!a.has(id)) removed.push(row);
  }
  return { added, removed, changed, unchanged: after.length - added.length - changed.length };
}

export function probeConnection(databaseUrl) {
  if (!databaseUrl) return { ok: false, detail: 'DATABASE_URL not set' };
  let normalized;
  try {
    normalized = toLibpqUrl(databaseUrl);
  } catch (e) {
    return { ok: false, detail: `unparseable DATABASE_URL: ${e.message}` };
  }
  const res = spawnSync('psql', [normalized, '-X', '-q', '-t', '-c', 'SELECT 1;'], { encoding: 'utf8', timeout: 5000 });
  if (res.error) return { ok: false, detail: `psql not runnable: ${res.error.message}` };
  if (res.status !== 0) return { ok: false, detail: (res.stderr || res.stdout || 'psql failed').trim().slice(0, 300) };
  return { ok: true, detail: 'psql SELECT 1 succeeded' };
}
