'use client';

import { AccountingDashboardClient } from './accounting-dashboard-client';

/**
 * /provider/accounting — the one accounting dashboard. Both finance roles land
 * here after login and see the same figures (operator 2026-09-11); admins and
 * the field inspector reach it by URL.
 */
export default function AccountingDashboardPage() {
  return <AccountingDashboardClient />;
}
