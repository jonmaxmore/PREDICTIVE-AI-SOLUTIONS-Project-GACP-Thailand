/**
 * Seed test provider accounts — one per canonical role.
 * Run: node scripts/db/seed-test-providers.js
 */
const { createProviderUser } = require('../../services/provider-user-service');

const TEST_PASSWORD = 'Test@12345';

const accounts = [
  { providerId: '1234567890001', email: 'admin@gacp-test.com',      firstName: 'Test', lastName: 'Admin',     role: 'admin' },
  { providerId: '1234567890002', email: 'reviewer@gacp-test.com',   firstName: 'Test', lastName: 'Reviewer',  role: 'document_reviewer' },
  { providerId: '1234567890003', email: 'dispatcher@gacp-test.com', firstName: 'Test', lastName: 'Dispatcher', role: 'dispatcher' },
  { providerId: '1234567890004', email: 'inspector@gacp-test.com',  firstName: 'Test', lastName: 'Inspector',  role: 'field_inspector' },
  { providerId: '1234567890005', email: 'account@gacp-test.com',    firstName: 'Test', lastName: 'Account',    role: 'account' },
  // ผู้อนุมัติใบรับรอง — ไม่มีแถวนี้ = ไม่มีใครเดินขา AUDIT_PASSED->APPROVED ได้
  // (F-CERT-SOD 2026-09-10) และ walk ทั้งชุดจะจบไม่ได้
  { providerId: '1234567890006', email: 'approver@gacp-test.com',   firstName: 'Test', lastName: 'Approver',   role: 'certificate_approver' },
];

async function main() {
  console.log('Creating test provider accounts...\n');

  for (const acct of accounts) {
    try {
      const result = await createProviderUser({
        ...acct,
        password: TEST_PASSWORD,
        actorId: null,
      });
      console.log(`${acct.role.padEnd(20)} → providerId: ${acct.providerId} (DB role: ${result.user.role})`);
    } catch (err) {
      if (err.status === 409) {
        console.log(`${acct.role.padEnd(20)} → already exists, skipping`);
      } else {
        console.error(`${acct.role.padEnd(20)} → ${err.message}`);
      }
    }
  }

  console.log('\nDone. Login with providerId + password: Test@12345');
  process.exit(0);
}

main();
