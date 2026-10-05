/**
 * SEC-PROV-001 — grant the `platform_admin` role to a designated operator.
 *
 * RUN MANUALLY at/after deploy. The platform-admin organization endpoints
 * (cross-tenant org CRUD, `withoutTenantScope`) now require role
 * `platform_admin` (canonical-rbac PLATFORM_ADMIN_ONLY); tenant `admin` is no
 * longer permitted. Exactly one (or a few) trusted platform operator account(s)
 * must be elevated, otherwise org provisioning is inaccessible.
 *
 * This script deliberately does NOT hardcode any user — the operator supplies
 * the target identity at runtime, so it never guesses who the platform owner is.
 *
 * Usage:
 *   node scripts/grant-platform-admin.js --email ops@example.com           # dry-run
 *   node scripts/grant-platform-admin.js --provider-id DOA_AB12CD --apply  # write
 *   node scripts/grant-platform-admin.js --id <uuid> --apply
 *
 * Safety:
 *   - Dry-run by default; pass --apply to actually write (mirrors
 *     migrate-account-role.js — an accidental run never mutates the DB).
 *   - Refuses if the target is missing, ambiguous, or not a PROVIDER account
 *     (platform_admin authenticates via the provider portal).
 *   - Idempotent: a user already on PLATFORM_ADMIN is a no-op.
 *   - The role flip + an AuditLog row are written in one $transaction.
 *
 * User.role is a String column (prisma/schema/auth.prisma), so no enum
 * migration is required; 'PLATFORM_ADMIN' matches the uppercase provider-role
 * convention and normalises to canonical `platform_admin`.
 */

'use strict';

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const TARGET_ROLE = 'PLATFORM_ADMIN';

function parseArgs(argv) {
  const out = { email: null, providerId: null, id: null };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--email') { out.email = argv[i + 1]; i += 1; }
    else if (a === '--provider-id') { out.providerId = argv[i + 1]; i += 1; }
    else if (a === '--id') { out.id = argv[i + 1]; i += 1; }
  }
  return out;
}

function usage(msg) {
  if (msg) { console.error(`[grant-platform-admin] ${msg}\n`); }
  console.error('Usage: node scripts/grant-platform-admin.js (--email <e> | --provider-id <p> | --id <uuid>) [--apply]');
  console.error('Default is dry-run. Pass --apply to write the change.');
}

async function main() {
  const isApply = process.argv.includes('--apply') && !process.argv.includes('--dry-run');
  const mode = isApply ? 'APPLY' : 'DRY-RUN';
  const { email, providerId, id } = parseArgs(process.argv);

  if (!email && !providerId && !id) {
    usage('a target user is required (--email, --provider-id, or --id).');
    process.exitCode = 1;
    return;
  }

  const or = [];
  if (email) { or.push({ email: String(email).trim().toLowerCase() }); }
  if (providerId) { or.push({ providerId: String(providerId).trim() }); }
  if (id) { or.push({ id: String(id).trim() }); }

  console.log(`[grant-platform-admin] mode=${mode} target=${TARGET_ROLE}`);
  console.log(`[grant-platform-admin] lookup=${JSON.stringify(or)}`);
  console.log('[grant-platform-admin] pass --apply to actually write changes.\n');

  const matches = await prisma.user.findMany({
    where: { OR: or },
    select: { id: true, email: true, role: true, accountType: true, providerId: true, organizationId: true },
  });

  if (matches.length === 0) {
    console.error('[grant-platform-admin] no user matched — nothing to do.');
    process.exitCode = 1;
    return;
  }
  if (matches.length > 1) {
    console.error(`[grant-platform-admin] ambiguous: ${matches.length} users matched. Narrow with --id.`);
    matches.forEach((u) => console.error(`  - ${u.id}  email=${u.email}  providerId=${u.providerId}`));
    process.exitCode = 1;
    return;
  }

  const user = matches[0];
  console.log(`[grant-platform-admin] target: id=${user.id} email=${user.email} role=${user.role} accountType=${user.accountType}`);

  if (user.accountType !== 'PROVIDER') {
    console.error(`[grant-platform-admin] REFUSING: accountType=${user.accountType} (platform_admin must be a PROVIDER account).`);
    process.exitCode = 1;
    return;
  }
  if (user.role === TARGET_ROLE) {
    console.log('[grant-platform-admin] user is already PLATFORM_ADMIN — no-op.');
    return;
  }

  console.log(`[grant-platform-admin] will change role: ${user.role} → ${TARGET_ROLE}`);

  if (!isApply) {
    console.log('\n[grant-platform-admin] dry-run complete. Re-run with --apply to grant.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { role: TARGET_ROLE, updatedAt: new Date() },
    });

    try {
      // eslint-disable-next-line gacp/no-direct-audit-or-notification-write -- one-shot CLI runs outside HTTP context (no req/tenant); the wrapping try/catch keeps an audit-row failure from blocking the role grant.
      await tx.auditLog.create({
        data: {
          category: 'USER',
          action: 'USER_ROLE_GRANTED',
          severity: 'WARNING',
          actorId: 'SYSTEM',
          actorRole: 'SYSTEM',
          actorType: 'SYSTEM',
          resourceType: 'USER',
          resourceId: user.id,
          metadata: {
            source: 'grant-platform-admin.js',
            previousRole: user.role,
            newRole: TARGET_ROLE,
            reason: 'SEC-PROV-001 platform-admin provisioning',
          },
        },
      });
    } catch (auditErr) {
      console.warn(`[grant-platform-admin] audit-log write failed for user ${user.id}:`, auditErr?.message);
    }
  });

  const confirmed = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, email: true, role: true },
  });
  console.log('\n[grant-platform-admin] done.');
  console.log(`  ${confirmed.id}  email=${confirmed.email}  role=${confirmed.role}`);
  console.log('\nNEXT: have the operator log in via the PROVIDER portal and confirm');
  console.log('access to /api/platform-admin/organizations. Tenant admins remain blocked.');
}

main()
  .catch((err) => {
    console.error('[grant-platform-admin] FAILED:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
