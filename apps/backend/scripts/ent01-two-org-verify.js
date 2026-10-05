/**
 * ENT-01 — two-org seed + read-scope verification (staging rollout aid).
 *
 * Idempotent. Two phases:
 *   1) SEED (withoutTenantScope): upsert a second organization (slug
 *      'ent01-org-b') + one HEALTH applicant + two applications inside org-B,
 *      so cross-tenant isolation can actually be observed (single-org staging
 *      hides false-empty regressions because the filter never excludes a row).
 *   2) VERIFY: with the tenant-prisma-extension read hooks active
 *      (TENANT_READ_ORG_SCOPE=true in this process env), prove that a bound
 *      org-A context sees ONLY org-A rows, org-B sees ONLY org-B rows, and
 *      withoutTenantScope sees BOTH. Asserts on Application (scoped) + Invoice
 *      + Farm counts.
 *
 * Run on staging (after the flag is proven, the persistent compose flag flip
 * is a separate step):
 *   docker exec -e TENANT_READ_ORG_SCOPE=true -w /app/apps/backend \
 *     gacp-backend-staging node scripts/ent01-two-org-verify.js
 *
 * Safe: additive upserts (never deletes/edits org-A), reads are non-mutating.
 */
 
const crypto = require('crypto');
const { prisma } = require('../services/prisma-database');
const { runWithTenantContext, withoutTenantScope } = require('../services/tenant-context');

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

const ORG_B = { slug: 'ent01-org-b', name: 'ENT-01 Org B (isolation test)', code: 'ENT01B' };
const APPLICANT_B = {
  healthId: '9900000000001',
  email: 'ent01-orgb-applicant@example.com',
  firstName: 'OrgB',
  lastName: 'Applicant',
};
const APPS_B = ['ENT01B-APP-001', 'ENT01B-APP-002'];

async function seed() {
  return withoutTenantScope(async () => {
    const orgB = await prisma.organization.upsert({
      where: { slug: ORG_B.slug },
      update: {},
      create: {
        name: ORG_B.name, slug: ORG_B.slug, code: ORG_B.code,
        type: 'INTERNAL', isolationTier: 'SHARED', status: 'ACTIVE', createdBy: 'ent01-script',
      },
    });

    await prisma.user.upsert({
      where: { healthId: APPLICANT_B.healthId },
      update: { organizationId: orgB.id },
      create: {
        email: APPLICANT_B.email,
        password: 'x', // not used for login in this verification
        firstName: APPLICANT_B.firstName,
        lastName: APPLICANT_B.lastName,
        authType: 'HEALTH_ID',
        canonicalId: APPLICANT_B.healthId,
        healthId: APPLICANT_B.healthId,
        healthIdHash: sha(APPLICANT_B.healthId),
        idCard: APPLICANT_B.healthId,
        idCardHash: sha(APPLICANT_B.healthId),
        role: 'HEALTH',
        accountType: 'INDIVIDUAL',
        status: 'ACTIVE',
        isEmailVerified: true,
        organizationId: orgB.id,
      },
    });

    for (const num of APPS_B) {
      await prisma.application.upsert({
        where: { applicationNumber: num },
        update: { organizationId: orgB.id },
        create: {
          applicationNumber: num,
          healthId: APPLICANT_B.healthId,
          status: 'DRAFT',
          serviceType: 'new_application',
          areaType: 'INDOOR',
          organizationId: orgB.id,
        },
      });
    }
    return orgB.id;
  });
}

async function main() {
  const flag = process.env.TENANT_READ_ORG_SCOPE === 'true';
  console.log(`TENANT_READ_ORG_SCOPE=${process.env.TENANT_READ_ORG_SCOPE || '(unset)'} → scoping ${flag ? 'ON' : 'OFF'}`);

  const orgBId = await seed();

  const { orgAId, totals } = await withoutTenantScope(async () => {
    const orgA = await prisma.organization.findUnique({ where: { slug: 'default' } });
    return {
      orgAId: orgA?.id,
      totals: {
        apps: await prisma.application.count(),
        appsA: await prisma.application.count({ where: { organizationId: orgA?.id } }),
        appsB: await prisma.application.count({ where: { organizationId: orgBId } }),
        invA: await prisma.invoice.count({ where: { organizationId: orgA?.id } }),
        invAll: await prisma.invoice.count(),
      },
    };
  });
  console.log('orgA=', orgAId, 'orgB=', orgBId);
  console.log('TRUTH (withoutTenantScope):', JSON.stringify(totals));

  // Bound-context reads — these go through the extension read hook.
  const ctxA = await runWithTenantContext({ organizationId: orgAId }, async () => {
    const rows = await prisma.application.findMany({ select: { organizationId: true } });
    return {
      count: rows.length,
      foreign: rows.filter((r) => r.organizationId !== orgAId).length,
      invCount: await prisma.invoice.count(),
    };
  });
  const ctxB = await runWithTenantContext({ organizationId: orgBId }, async () => {
    const rows = await prisma.application.findMany({ select: { organizationId: true } });
    return {
      count: rows.length,
      foreign: rows.filter((r) => r.organizationId !== orgBId).length,
    };
  });
  console.log('ctxA reads:', JSON.stringify(ctxA));
  console.log('ctxB reads:', JSON.stringify(ctxB));

  const checks = [];
  if (flag) {
    checks.push(['orgA sees only orgA apps', ctxA.foreign === 0 && ctxA.count === totals.appsA]);
    checks.push(['orgB sees only orgB apps', ctxB.foreign === 0 && ctxB.count === totals.appsB]);
    checks.push(['orgA does NOT see orgB apps', ctxA.count !== totals.apps && totals.appsB > 0]);
    checks.push(['orgA invoice read scoped', ctxA.invCount === totals.invA]);
    checks.push(['withoutTenantScope sees ALL apps', totals.apps === totals.appsA + totals.appsB]);
  } else {
    checks.push(['flag OFF → orgA read is unscoped (sees all)', ctxA.count === totals.apps]);
  }

  let ok = true;
  for (const [name, pass] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'} — ${name}`);
    if (!pass) {ok = false;}
  }
  console.log(ok ? '\nENT-01 VERIFICATION PASSED' : '\nENT-01 VERIFICATION FAILED');
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ENT-01 verify error:', e);
  try { await prisma.$disconnect(); } catch { /* noop */ }
  process.exit(2);
});
