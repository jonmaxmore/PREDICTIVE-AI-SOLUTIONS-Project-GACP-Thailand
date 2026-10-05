/**
 * Regression guard for FE↔BE provider-dashboard KPI field-name drift.
 *
 * Two KPI tiles silently rendered 0 because a global enum rename drifted the FE
 * field names away from the keys the backend dashboard handlers actually emit:
 *   - auditor:  FE `AUDIT_PASSEDToday`     vs  BE auditor-dashboard-handler.js → `auditedToday`
 *   - calendar: FE `pendingAUDIT_FEE_PAID` vs  BE scheduler-dashboard-handler.js → `pendingScheduling`
 *
 * `typecheck:web` couples each FE type to its read-sites, but NOT to the backend
 * (separate JS handlers, no shared schema). This test pins the FE kpi shape to the
 * exact keys the BE emits — the names below are the contract. If a future rename
 * drifts either side again, this fails instead of silently zeroing a tile.
 *
 * Backend source of the expected keys:
 *   apps/backend/routes/api/provider/handlers/auditor-dashboard-handler.js   (kpi.auditedToday)
 *   apps/backend/routes/api/provider/handlers/scheduler-dashboard-handler.js (kpi.pendingScheduling)
 */
import { describe, expect, it } from '@jest/globals';

import { EMPTY_DASHBOARD as AUDITOR_EMPTY } from '../audits/auditor-types';
import { EMPTY_DASHBOARD as CALENDAR_EMPTY } from '../calendar/calendar-types';

describe('[kpi-contract] auditor dashboard kpi field names', () => {
  it('uses `auditedToday` (BE key), not the drifted `AUDIT_PASSEDToday`', () => {
    expect(AUDITOR_EMPTY.kpi).toHaveProperty('auditedToday');
    expect(AUDITOR_EMPTY.kpi).not.toHaveProperty('AUDIT_PASSEDToday');
  });
});

describe('[kpi-contract] scheduler calendar kpi field names', () => {
  it('uses `pendingScheduling` (BE key), not the drifted `pendingAUDIT_FEE_PAID`', () => {
    expect(CALENDAR_EMPTY.kpi).toHaveProperty('pendingScheduling');
    expect(CALENDAR_EMPTY.kpi).not.toHaveProperty('pendingAUDIT_FEE_PAID');
  });
});
