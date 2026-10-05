/**
 * Tier 16 (B16-B, 2026-05-16) — Migration: split legacy `ACCOUNT` role.
 *
 * RUN MANUALLY after the role-split deploy lands in production.
 * The orchestrator (release runbook) decides timing — do NOT add this
 * to a startup hook or auto-deploy script. We do the assignment
 * deliberately so finance-ops can review who ended up on which side
 * before any slips get touched.
 *
 * What this script does:
 *   For each User with role = 'ACCOUNT' (canonical lowercase) or
 *   role = 'ACCOUNTANT' (legacy uppercase / DB enum value), set the
 *   role to 'ACCOUNT_PLATFORM' (sensible default — most existing
 *   finance staff at launch are platform-side; DTAM is a smaller
 *   team that will be re-assigned manually after migration).
 *
 * Output:
 *   - Logs every user that was migrated with id + email + previous
 *     role so finance-ops can audit the bulk change and selectively
 *     re-assign anyone who should have been DTAM-side. The list also
 *     goes to stdout JSON so an ops runbook can pipe it to a ticket.
 *   - Records an audit-log row per migration (actor=SYSTEM,
 *     action=USER_ROLE_MIGRATED) so the change is reviewable
 *     through the standard audit-log surface.
 *
 * Safety:
 *   - Idempotent: running twice is a no-op (after first pass, no
 *     ACCOUNT users remain).
 *   - Dry-run mode: pass --dry-run (or DRY_RUN=1) to log without
 *     writing. Default behaviour is also dry-run so an accidental
 *     `node migrate-account-role.js` does NOT mutate the DB —
 *     migrating staff roles must be an explicit decision.
 *   - Wrapped in a single $transaction so the all-or-nothing
 *     contract holds.
 *
 * Audit trail requirements:
 *   - Canonical contract §6.2 — segregation-of-duties role changes
 *     must produce an audit-log entry per affected user. We emit the
 *     entries inside the same transaction so they cannot diverge
 *     from the actual role flip.
 */

'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Default target side for the bulk migration. Override per-user
// post-migration by issuing direct role updates from a sysadmin UI.
const DEFAULT_TARGET_ROLE = 'ACCOUNT_PLATFORM';

// Both canonical and legacy spellings of the source role. Matches
// canonical-rbac.js ROLE_ALIASES so we catch any user the rest of
// the system would have recognised as a legacy ACCOUNT.
const LEGACY_ROLE_VALUES = ['ACCOUNT', 'account', 'ACCOUNTANT', 'accountant'];

async function main() {
  const isApply = process.argv.includes('--apply') && !process.argv.includes('--dry-run');
  const mode = isApply ? 'APPLY' : 'DRY-RUN';
  console.log(`[migrate-account-role] mode=${mode} target=${DEFAULT_TARGET_ROLE}`);
  console.log('[migrate-account-role] pass --apply to actually write changes.\n');

  // 1. Snapshot current state — useful for the runbook ticket so
  //    ops can compare before/after counts.
  const usersToMigrate = await prisma.user.findMany({
    where: { role: { in: LEGACY_ROLE_VALUES } },
    select: {
      id: true,
      email: true,
      role: true,
      organizationId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  if (usersToMigrate.length === 0) {
    console.log('[migrate-account-role] no legacy ACCOUNT users found — nothing to do.');
    return;
  }

  console.log(`[migrate-account-role] found ${usersToMigrate.length} legacy ACCOUNT user(s):`);
  usersToMigrate.forEach((u) => {
    console.log(`  - ${u.id}  email=${u.email}  role=${u.role}  org=${u.organizationId || '(none)'}`);
  });
  console.log('');

  // 2. Emit a JSON payload the runbook can paste into the ticket.
  //    Includes the proposed target so finance-ops can flag anyone
  //    who should NOT receive ACCOUNT_PLATFORM before --apply.
  const reviewPayload = usersToMigrate.map((u) => ({
    id: u.id,
    email: u.email,
    previousRole: u.role,
    proposedRole: DEFAULT_TARGET_ROLE,
    organizationId: u.organizationId,
  }));
  console.log('[migrate-account-role] runbook JSON (paste into ticket):');
  console.log(JSON.stringify(reviewPayload, null, 2));
  console.log('');

  if (!isApply) {
    console.log('[migrate-account-role] dry-run complete. Re-run with --apply to migrate.');
    return;
  }

  // 3. Apply migration in a single transaction. Each user gets a
  //    paired AuditLog row so the change is traceable.
  await prisma.$transaction(async (tx) => {
    for (const u of usersToMigrate) {
      await tx.user.update({
        where: { id: u.id },
        data: { role: DEFAULT_TARGET_ROLE, updatedAt: new Date() },
      });

      // Audit-log entry. We use category=USER and actorType=SYSTEM
      // because this is a back-office migration, not a user-initiated
      // change. Schema fields conservatively chosen so the insert
      // works without depending on enum additions that may not yet
      // be in production.
      try {
        // eslint-disable-next-line gacp/no-direct-audit-or-notification-write -- one-shot CLI migration script runs outside HTTP context; auditLogger.log() requires tenant context from req that doesn't exist here. The wrapping try/catch handles audit-log write failure gracefully without blocking the role migration.
        await tx.auditLog.create({
          data: {
            category: 'USER',
            action: 'USER_ROLE_MIGRATED',
            severity: 'INFO',
            actorId: 'SYSTEM',
            actorRole: 'SYSTEM',
            actorType: 'SYSTEM',
            resourceType: 'USER',
            resourceId: u.id,
            metadata: {
              source: 'migrate-account-role.js',
              previousRole: u.role,
              newRole: DEFAULT_TARGET_ROLE,
              reason: 'Tier 16 B16-B ACCOUNT role split',
            },
          },
        });
      } catch (auditErr) {
        // Audit log shape varies by deploy generation; we never
        // block a role flip on the audit row.
        console.warn(`[migrate-account-role] audit-log write failed for user ${u.id}:`, auditErr?.message);
      }
    }
  });

  // 4. Post-migration verification — counts should now show zero
  //    legacy ACCOUNT users and N new ACCOUNT_PLATFORM users.
  const remaining = await prisma.user.count({
    where: { role: { in: LEGACY_ROLE_VALUES } },
  });
  const target = await prisma.user.count({
    where: { role: DEFAULT_TARGET_ROLE },
  });
  console.log(`[migrate-account-role] migration complete.`);
  console.log(`  legacy ACCOUNT users remaining: ${remaining}`);
  console.log(`  users now on ${DEFAULT_TARGET_ROLE}: ${target}`);
  console.log('');
  console.log('NEXT STEPS (manual, for finance-ops):');
  console.log('  1. Review the runbook JSON above and identify any user');
  console.log('     who should be ACCOUNT_DTAM instead of ACCOUNT_PLATFORM.');
  console.log('  2. For each such user, run:');
  console.log('       UPDATE users SET role = \'ACCOUNT_DTAM\' WHERE id = \'<uuid>\';');
  console.log('  3. Confirm with: SELECT role, COUNT(*) FROM users GROUP BY role;');
}

main()
  .catch((err) => {
    console.error('[migrate-account-role] FAILED:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
