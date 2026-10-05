/**
 * PDPA remediation backfill — mask the plaintext ID in historical LOGIN_FAILURE
 * audit rows. Tests the pure masking core + the injected-prisma driver.
 *
 * Provider-ID carpet UAT 2026-07-09 finding: 32 prod / ~10 staging rows leaked a
 * bare 13-digit national/provider ID in metadata.identifier (pre-#440).
 */

'use strict';

const {
  maskIdentifier,
  maskMetadataValue,
  backfill,
} = require('../../scripts/pdpa/backfill-mask-audit-login-identifier');

describe('maskIdentifier — matches the forward path (first-4 + ****)', () => {
  it('masks a bare 13-digit national ID', () => {
    expect(maskIdentifier('4310100001149')).toBe('4310****');
    expect(maskIdentifier('1100000000008')).toBe('1100****');
  });
  it('leaves an already-masked value untouched (idempotent)', () => {
    expect(maskIdentifier('1100****')).toBe('1100****');
  });
  it('leaves a non-13-digit value untouched (email / short code / null)', () => {
    expect(maskIdentifier('user@example.com')).toBe('user@example.com');
    expect(maskIdentifier('12345')).toBe('12345');
    expect(maskIdentifier(null)).toBeNull();
    expect(maskIdentifier(undefined)).toBeUndefined();
  });
  it('does NOT match a 13-digit run embedded in a longer string (invoiceId safety)', () => {
    // The false-positive class: 13 digits inside an invoice number.
    expect(maskIdentifier('INV-1780662006401-A5D7BB129')).toBe('INV-1780662006401-A5D7BB129');
  });
});

describe('maskMetadataValue — double-encoded jsonb STRING (the live shape)', () => {
  it('masks the identifier leaf and returns a re-stringified JSON string', () => {
    const before = JSON.stringify({ error: 'Invalid credentials', identifier: '4310100001149' });
    const { changed, value } = maskMetadataValue(before);
    expect(changed).toBe(true);
    expect(value).toBe(JSON.stringify({ error: 'Invalid credentials', identifier: '4310****' }));
    // still valid JSON, other fields preserved
    expect(JSON.parse(value)).toEqual({ error: 'Invalid credentials', identifier: '4310****' });
  });

  it('is idempotent — an already-masked row is not changed', () => {
    const already = JSON.stringify({ error: 'Invalid credentials', identifier: '1100****' });
    expect(maskMetadataValue(already)).toEqual({ changed: false, value: already });
  });

  it('does not touch metadata with no 13-digit identifier (e.g. an email login)', () => {
    const s = JSON.stringify({ error: 'Invalid credentials', identifier: 'a@b.com' });
    expect(maskMetadataValue(s)).toEqual({ changed: false, value: s });
  });

  it('leaves non-JSON / non-object metadata untouched', () => {
    expect(maskMetadataValue('not json')).toEqual({ changed: false, value: 'not json' });
    expect(maskMetadataValue(null)).toEqual({ changed: false, value: null });
    expect(maskMetadataValue(42)).toEqual({ changed: false, value: 42 });
  });

  it('also handles a plain jsonb OBJECT (future-safe, not the current shape)', () => {
    const obj = { error: 'x', identifier: '4310100001149' };
    const { changed, value } = maskMetadataValue(obj);
    expect(changed).toBe(true);
    expect(value).toEqual({ error: 'x', identifier: '4310****' });
  });
});

describe('backfill — injected prisma driver', () => {
  function makeRows() {
    return [
      { id: 'r1', sequenceNumber: 5, metadata: JSON.stringify({ error: 'Invalid credentials', identifier: '4310100001149' }) },
      { id: 'r2', sequenceNumber: 6, metadata: JSON.stringify({ error: 'Invalid credentials', identifier: '1100****' }) }, // already masked
      { id: 'r3', sequenceNumber: 7, metadata: JSON.stringify({ error: 'Invalid credentials', identifier: 'a@b.com' }) }, // email
      { id: 'r4', sequenceNumber: 8, metadata: JSON.stringify({ error: 'Invalid credentials', identifier: '5298565951838' }) },
    ];
  }
  function fakePrisma(rows) {
    const updates = [];
    return {
      updates,
      auditLog: {
        findMany: jest.fn(async () => rows),
        update: jest.fn(async ({ where, data }) => { updates.push({ id: where.id, metadata: data.metadata }); return {}; }),
      },
    };
  }

  it('dry-run masks NOTHING but reports what would change', async () => {
    const prisma = fakePrisma(makeRows());
    const s = await backfill({ prisma, dryRun: true });
    expect(s).toMatchObject({ scanned: 4, masked: 2, skipped: 2, dryRun: true });
    expect(prisma.auditLog.update).not.toHaveBeenCalled();
    expect(prisma.updates).toHaveLength(0);
  });

  it('--apply masks exactly the two bare-13-digit rows, leaves masked/email rows', async () => {
    const prisma = fakePrisma(makeRows());
    const s = await backfill({ prisma, dryRun: false });
    expect(s).toMatchObject({ scanned: 4, masked: 2, skipped: 2, dryRun: false });
    const ids = prisma.updates.map((u) => u.id).sort();
    expect(ids).toEqual(['r1', 'r4']);
    expect(JSON.parse(prisma.updates.find((u) => u.id === 'r1').metadata).identifier).toBe('4310****');
    expect(JSON.parse(prisma.updates.find((u) => u.id === 'r4').metadata).identifier).toBe('5298****');
  });

  it('re-running --apply on already-masked data is a no-op (idempotent)', async () => {
    const masked = makeRows().map((r) => {
      const { value } = maskMetadataValue(r.metadata);
      return { ...r, metadata: value };
    });
    const prisma = fakePrisma(masked);
    const s = await backfill({ prisma, dryRun: false });
    expect(s.masked).toBe(0);
    expect(prisma.auditLog.update).not.toHaveBeenCalled();
  });
});
