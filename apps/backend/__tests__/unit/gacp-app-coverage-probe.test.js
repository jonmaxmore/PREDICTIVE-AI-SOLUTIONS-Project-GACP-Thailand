'use strict';
const { findUngrantedTables } = require('../../scripts/rls/gacp-app-coverage-probe');

// A fake prisma whose $queryRawUnsafe answers the two catalog queries the probe issues.
function makePrisma({ tables, grants }) {
  return {
    $queryRawUnsafe: jest.fn(async (sql, ...args) => {
      if (/pg_class/.test(sql)) { return tables.map((t) => ({ relname: t })); }
      // role_table_grants lookup for one table (table name is the bound arg)
      const table = args[0];
      return (grants[table] || []).map((p) => ({ privilege_type: p }));
    }),
  };
}

describe('findUngrantedTables', () => {
  const ALL4 = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
  test('returns empty when gacp_app has full DML on every table', async () => {
    const prisma = makePrisma({ tables: ['applications', 'receipt_sequences'], grants: { applications: ALL4, receipt_sequences: ALL4 } });
    expect(await findUngrantedTables(prisma)).toEqual([]);
  });
  test('reports a table that is missing grants (the boot-breaker case)', async () => {
    const prisma = makePrisma({ tables: ['applications', 'receipt_sequences'], grants: { applications: ALL4, receipt_sequences: [] } });
    expect(await findUngrantedTables(prisma)).toEqual([{ table: 'receipt_sequences', missing: ALL4 }]);
  });
  test('reports a partial grant (only SELECT)', async () => {
    const prisma = makePrisma({ tables: ['x'], grants: { x: ['SELECT'] } });
    expect(await findUngrantedTables(prisma)).toEqual([{ table: 'x', missing: ['INSERT', 'UPDATE', 'DELETE'] }]);
  });

  // RULING 4 (task-2-brief deviation): the probe's pg_class predicate must be a
  // STRICT SUPERSET of Task 1's grant predicate (relkind='r') — widened to
  // relkind IN ('r','p') — so a partitioned PARENT table added later & left
  // ungranted is still caught, not silently skipped like the grant would skip it.
  // The 3 tests above are relkind-agnostic (the mock ignores the predicate
  // text), so this test additionally captures the actual SQL sent and asserts
  // the widened predicate is really there, not just that /pg_class/ matches.
  test('[Ruling 4] pg_class predicate is widened to relkind IN (\'r\',\'p\') and reports an ungranted partitioned-parent-style table', async () => {
    let capturedSql = null;
    const prisma = {
      $queryRawUnsafe: jest.fn(async (sql, ...args) => {
        if (/pg_class/.test(sql)) {
          capturedSql = sql;
          return [{ relname: 'events_partitioned' }];
        }
        const table = args[0];
        return table === 'events_partitioned' ? [] : [];
      }),
    };
    const result = await findUngrantedTables(prisma);
    expect(capturedSql).toMatch(/relkind\s+IN\s*\(\s*'r'\s*,\s*'p'\s*\)/i);
    expect(capturedSql).toMatch(/nspname\s*=\s*'public'/);
    expect(result).toEqual([{ table: 'events_partitioned', missing: ALL4 }]);
  });
});
