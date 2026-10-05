'use strict';
const { SETTLEMENT, SETTLEMENT_DEFAULTS, loadSettlementFromSystemConfig } = require('../../config/business-rules');

describe('SETTLEMENT config', () => {
  it('exposes bounded-tx + retry defaults', () => {
    expect(SETTLEMENT.TX_TIMEOUT_MS).toBeGreaterThanOrEqual(30000);
    expect(SETTLEMENT.TX_MAX_WAIT_MS).toBeGreaterThanOrEqual(10000);
    expect(SETTLEMENT.MAX_ATTEMPTS).toBeGreaterThanOrEqual(5);
    expect(Array.isArray(SETTLEMENT.RETRY_BACKOFF_MS)).toBe(true);
    expect(SETTLEMENT.RETRY_BACKOFF_MS.length).toBeGreaterThan(0);
    expect(SETTLEMENT.RECONCILE_STALE_MS).toBeGreaterThan(0);
    expect(SETTLEMENT.RECONCILE_BATCH).toBeGreaterThan(0);
  });

  it('guards against NaN corruption on bad SystemConfig values', async () => {
    // Save original value before test
    const originalMaxAttempts = SETTLEMENT.MAX_ATTEMPTS;
    const originalTimeout = SETTLEMENT.TX_TIMEOUT_MS;

    // Mock prisma with one good row and one bad row
    const fakePrisma = {
      systemConfig: {
        findMany: async () => [
          { key: 'settlement.max_attempts', value: '9' },       // good value
          { key: 'settlement.tx_timeout_ms', value: 'not-a-number' }, // bad value
        ],
      },
    };

    // Call loader with fake prisma
    await loadSettlementFromSystemConfig(fakePrisma);

    // Assert: good value is applied
    expect(SETTLEMENT.MAX_ATTEMPTS).toBe(9);

    // Assert: bad value is rejected (remains finite, not NaN)
    expect(Number.isFinite(SETTLEMENT.TX_TIMEOUT_MS)).toBe(true);
    expect(SETTLEMENT.TX_TIMEOUT_MS).toBe(originalTimeout); // unchanged from bad input

    // Restore for other tests
    SETTLEMENT.MAX_ATTEMPTS = originalMaxAttempts;
    SETTLEMENT.TX_TIMEOUT_MS = originalTimeout;
  });
});
