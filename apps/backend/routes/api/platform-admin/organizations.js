/**
 * Platform-Admin Organization API (ADR-014, business-value milestone).
 *
 * Cross-tenant CRUD for the Organization entity. These endpoints are how a
 * new tenant is provisioned — without them, the multi-tenant foundation
 * cannot actually onboard anyone.
 *
 * All handlers run inside `withoutTenantScope` because the operation by
 * definition crosses tenant boundaries: a platform admin listing all
 * organizations, or creating a new one before any user belongs to it.
 *
 * Access: requires authenticateProvider + PLATFORM_ADMIN role (canonical-rbac
 * ROLE_GROUPS.PLATFORM_ADMIN_ONLY). Tenant ADMIN is intentionally excluded so a
 * tenant admin cannot manage other tenants cross-scope (SEC-PROV-001).
 */

const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const { prisma } = require('../../../services/prisma-database');
const { withoutTenantScope } = require('../../../services/tenant-context');
const { authenticateProvider, requireRole } = require('../../../middleware/auth-middleware');
const { ROLE_GROUPS, normalizeRole, CANONICAL_ROLES } = require('../../../shared/canonical-rbac');
const { createLogger } = require('../../../shared/logger');
const { computeLookupHmac } = require('../../../utils/field-encryption');
const { resolveCanonicalIdForWrite, useFkToken } = require('../../../shared/fk-token');
// ฟังก์ชันเดียวกับที่ประตูล็อกอินใช้ค้นหาคน — เขียนกับอ่านต้องใช้ตัวเดียวกัน ไม่งั้นดริฟต์เงียบ
const { computeIdentifierHash } = require('../../../services/user-lookup-service');

const BCRYPT_ROUNDS = 12;
/**
 * บทบาทที่คอนโซลของบริษัทสร้างให้องค์กรได้
 *
 * เดิมเป็นคำตัวพิมพ์ใหญ่ยุคก่อน (`ADMIN` · `AUDITOR` · `SCHEDULER` · `ACCOUNT`) ซึ่งหลัง
 * ตัดขาดจากคำเก่า 2026-09-10 จะทำให้ zod ปฏิเสธคำที่ระบบใช้จริงด้วย 400 — อาการบนของจริง
 * คือสร้างเจ้าหน้าที่ไม่ได้เลยสักคน
 *
 * `system_admin_platform` ไม่อยู่ในรายการโดยเจตนา: ผู้ปฏิบัติการข้ามองค์กรต้องถูกตั้งนอก
 * ประตูนี้ (seed/ops) — provider-user-service ก็ปฏิเสธซ้ำอีกชั้นด้วย 403
 */
const PROVIDER_ROLES_ALLOWED = [
    CANONICAL_ROLES.DOCUMENT_REVIEWER,
    CANONICAL_ROLES.DISPATCHER,
    CANONICAL_ROLES.FIELD_INSPECTOR,
    CANONICAL_ROLES.CERTIFICATE_APPROVER,
    CANONICAL_ROLES.FINANCE_OFFICER_DTAM,
    CANONICAL_ROLES.FINANCE_OFFICER_PLATFORM,
    CANONICAL_ROLES.SYSTEM_ADMIN_DTAM,
];

const logger = createLogger('platform-admin-organizations');
const router = express.Router();

const ORG_TYPES = ['GOVERNMENT', 'PRIVATE_CERTIFIER', 'COOPERATIVE', 'FOREIGN_STANDARD', 'INTERNAL'];
const ISOLATION_TIERS = ['SHARED', 'DEDICATED'];
const ORG_STATUS = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'];

const slugRegex = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const codeRegex = /^[A-Z0-9](?:[A-Z0-9_]{0,30}[A-Z0-9])?$/;

const createSchema = z.object({
  name: z.string().trim().min(1).max(255),
  slug: z.string().trim().regex(slugRegex,
    'slug must be lowercase alphanumeric with hyphens, 1–64 chars'),
  code: z.string().trim().regex(codeRegex,
    'code must be uppercase alphanumeric with underscores, 1–32 chars'),
  type: z.enum(ORG_TYPES).default('PRIVATE_CERTIFIER'),
  isolationTier: z.enum(ISOLATION_TIERS).default('SHARED'),
  contactEmail: z.string().trim().email().optional(),
  legalName: z.string().trim().max(255).optional(),
  taxId: z.string().trim().max(20).optional(),
  locale: z.string().trim().default('th-TH'),
  timezone: z.string().trim().default('Asia/Bangkok'),
  settings: z.record(z.string(), z.unknown()).optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  status: z.enum(ORG_STATUS).optional(),
  isolationTier: z.enum(ISOLATION_TIERS).optional(),
  contactEmail: z.string().trim().email().nullable().optional(),
  legalName: z.string().trim().max(255).nullable().optional(),
  taxId: z.string().trim().max(20).nullable().optional(),
  locale: z.string().trim().optional(),
  timezone: z.string().trim().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

const listQuerySchema = z.object({
  status: z.enum(ORG_STATUS).optional(),
  type: z.enum(ORG_TYPES).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

function publicView(org) {
  if (!org) {return null;}
  const { taxIdHash: _hash, ...rest } = org;
  return rest;
}

// ─────────────────────────────────────────────────
// POST /api/platform-admin/organizations
// Create a new tenant. Slug + code must be unique.
// ─────────────────────────────────────────────────
router.post(
  '/',
  authenticateProvider,
  requireRole(ROLE_GROUPS.PLATFORM_ADMIN_ONLY),
  async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'ValidationError',
        message: 'Invalid organization payload',
        details: parsed.error.flatten(),
      });
    }
    const data = parsed.data;
    // PDPA close-natid-round4 — `taxId` (the tenant's 13-digit Thai tax ID) is
    // encrypted at rest by the prisma-pdpa-extension `organization` hook, so it
    // can no longer carry the dedup/uniqueness invariant (random-IV AES-GCM →
    // each write differs). Populate the PRE-EXISTING keyed `taxIdHash @unique`
    // column with computeLookupHmac(taxId) so tenant-TIN uniqueness is enforced
    // on the deterministic hash instead. Mirrors PurchaseInvoice.supplierTaxIdHmac.
    const taxId = data.taxId || null;
    const taxIdHash = taxId ? computeLookupHmac(taxId) : null;
    try {
      const created = await withoutTenantScope(() =>
        prisma.organization.create({
          data: {
            name: data.name,
            slug: data.slug,
            code: data.code,
            type: data.type,
            isolationTier: data.isolationTier,
            contactEmail: data.contactEmail || null,
            legalName: data.legalName || null,
            taxId,
            taxIdHash,
            locale: data.locale,
            timezone: data.timezone,
            settings: data.settings ?? {},
            createdBy: req.user?.id || null,
          },
        }),
      );
      logger.info(`[org-create] id=${created.id} slug=${created.slug} by=${req.user?.id}`);
      return res.status(201).json({ success: true, data: publicView(created) });
    } catch (err) {
      // Prisma's P2002 = unique constraint violation
      if (err && err.code === 'P2002') {
        return res.status(409).json({
          success: false,
          error: 'Conflict',
          message: 'An organization with that slug, code, or taxId already exists',
          target: err.meta?.target,
        });
      }
      logger.error('[org-create] failed:', err.message);
      return res.status(500).json({
        success: false,
        error: 'ServerError',
        message: 'Failed to create organization',
      });
    }
  },
);

// ─────────────────────────────────────────────────
// GET /api/platform-admin/organizations
// Cursor-paginated listing. Filter by status / type / search.
// ─────────────────────────────────────────────────
router.get(
  '/',
  authenticateProvider,
  requireRole(ROLE_GROUPS.PLATFORM_ADMIN_ONLY),
  async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'ValidationError',
        details: parsed.error.flatten(),
      });
    }
    const { status, type, search, limit, cursor } = parsed.data;

    const where = { isDeleted: false };
    if (status) {where.status = status;}
    if (type) {where.type = type;}
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search.toLowerCase() } },
        { code: { contains: search.toUpperCase() } },
      ];
    }

    try {
      const rows = await withoutTenantScope(() =>
        prisma.organization.findMany({
          where,
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: { createdAt: 'desc' },
        }),
      );
      const hasMore = rows.length > limit;
      const items = (hasMore ? rows.slice(0, limit) : rows).map(publicView);
      const nextCursor = hasMore ? items[items.length - 1].id : null;
      // Nested under `data` so the api-client's `data` unwrap doesn't strip
      // the cursor sibling field on the frontend.
      return res.json({ success: true, data: { items, nextCursor } });
    } catch (err) {
      logger.error('[org-list] failed:', err.message);
      return res.status(500).json({
        success: false,
        error: 'ServerError',
        message: 'Failed to list organizations',
      });
    }
  },
);

// ─────────────────────────────────────────────────
// GET /api/platform-admin/organizations/:id
// ─────────────────────────────────────────────────
router.get(
  '/:id',
  authenticateProvider,
  requireRole(ROLE_GROUPS.PLATFORM_ADMIN_ONLY),
  async (req, res) => {
    try {
      const org = await withoutTenantScope(() =>
        prisma.organization.findUnique({ where: { id: req.params.id } }),
      );
      if (!org || org.isDeleted) {
        return res.status(404).json({
          success: false,
          error: 'NotFound',
          message: 'Organization not found',
        });
      }
      return res.json({ success: true, data: publicView(org) });
    } catch (err) {
      logger.error('[org-get] failed:', err.message);
      return res.status(500).json({
        success: false,
        error: 'ServerError',
        message: 'Failed to load organization',
      });
    }
  },
);

// ─────────────────────────────────────────────────
// PATCH /api/platform-admin/organizations/:id
// Updatable: name, status, isolationTier, contactEmail, legalName, taxId,
// locale, timezone, settings. Slug and code are immutable.
// ─────────────────────────────────────────────────
router.patch(
  '/:id',
  authenticateProvider,
  requireRole(ROLE_GROUPS.PLATFORM_ADMIN_ONLY),
  async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'ValidationError',
        details: parsed.error.flatten(),
      });
    }
    const update = { ...parsed.data, updatedBy: req.user?.id || null };
    // PDPA close-natid-round4 — keep the keyed `taxIdHash @unique` in lockstep
    // with `taxId` ONLY when the PATCH actually carries a `taxId` field (present
    // in parsed.data). An omitted `taxId` leaves both columns untouched; a
    // `taxId: null` clears both; a new value re-derives the hash. `taxId` itself
    // is encrypted at rest by the prisma-pdpa-extension `organization` hook.
    if ('taxId' in parsed.data) {
      update.taxIdHash = parsed.data.taxId ? computeLookupHmac(parsed.data.taxId) : null;
    }
    try {
      const existing = await withoutTenantScope(() =>
        prisma.organization.findUnique({ where: { id: req.params.id } }),
      );
      if (!existing || existing.isDeleted) {
        return res.status(404).json({
          success: false,
          error: 'NotFound',
          message: 'Organization not found',
        });
      }
      const updated = await withoutTenantScope(() =>
        prisma.organization.update({
          where: { id: req.params.id },
          data: update,
        }),
      );
      logger.info(`[org-update] id=${updated.id} by=${req.user?.id}`);
      return res.json({ success: true, data: publicView(updated) });
    } catch (err) {
      logger.error('[org-update] failed:', err.message);
      return res.status(500).json({
        success: false,
        error: 'ServerError',
        message: 'Failed to update organization',
      });
    }
  },
);

// ─────────────────────────────────────────────────
// POST /api/platform-admin/organizations/:id/users
// Provision the first user of a tenant. Generates a stable providerId
// derived from org.code + a random suffix; hashes the password (or
// generates one and returns it ONCE in the response).
// ─────────────────────────────────────────────────
const createUserSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phoneNumber: z.string().trim().max(30).optional(),
  role: z.enum(PROVIDER_ROLES_ALLOWED).default(CANONICAL_ROLES.SYSTEM_ADMIN_DTAM),
  password: z.string().min(12).max(128).optional(),
  /**
   * เลขบนบัตรประจำตัวเจ้าหน้าที่ของรัฐ — ผู้ดูแลเป็นคนกรอกให้
   *
   * มติ operator 2026-09-12: "ใน demo เรา account ของ provider ต้องมาจาก admin สร้างให้
   * โดยใช้หมายเลขบัตรราชการ" · ของจริงบนหมอพร้อมอาจมาจากการอัปเดตผ่าน Health ID
   * ซึ่ง **ยังไม่ยืนยัน** จึงไม่ฝังสมมติฐานนั้นลงที่นี่
   *
   * กติกาตรงกับประตูล็อกอินเป๊ะ (auth-provider.js: ลบขีดออกแล้วต้องเป็นเลข 13 หลัก)
   * ไม่ตรวจ Mod-11 เพราะบัญชีเจ้าหน้าที่ที่ใช้งานอยู่ทั้งแปดคนไม่ผ่าน checksum และ
   * ประตูล็อกอินก็ไม่ตรวจ — เพิ่มกติกาที่ประตูไม่มี จะทำให้สร้างบัญชีแบบเดียวกับที่มีอยู่ไม่ได้
   */
  providerId: z.string().trim()
    .transform((v) => v.replace(/-/g, ''))
    .refine((v) => /^\d{13}$/.test(v), {
      message: 'เลขประจำตัวเจ้าหน้าที่ต้องเป็นตัวเลข 13 หลัก',
    }),
});

function generatePassword() {
  // 16 bytes → 22 url-safe characters; sufficient entropy for a temporary
  // bootstrap password. Caller is expected to rotate after first login.
  return crypto.randomBytes(16).toString('base64url');
}

// buildProviderId() ถูกถอดออก 2026-09-12 — มันสร้างรหัสสังเคราะห์รูป `ORG_5BB283`
// ซึ่งประตูล็อกอินปฏิเสธทันที ("Provider ID ต้องเป็นเลขบัตรประชาชน 13 หลัก")
// บัญชีที่สร้างจึงใช้ไม่ได้ตั้งแต่วินาทีแรก · เจตนาเดิมคือเลี่ยงเก็บเลขบัตรจริงตอน bootstrap
// tenant ใหม่ ซึ่งเป็นเจตนาที่ดี แต่ไม่มีประตูไหนรองรับมัน
//
// มติ operator 2026-09-12 สำหรับ demo: ผู้ดูแลเป็นคนกรอกหมายเลขบัตรราชการให้

router.post(
  '/:id/users',
  authenticateProvider,
  requireRole(ROLE_GROUPS.PLATFORM_ADMIN_ONLY),
  async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'ValidationError',
        details: parsed.error.flatten(),
      });
    }
    const input = parsed.data;
    const orgId = req.params.id;

    try {
      const org = await withoutTenantScope(() =>
        prisma.organization.findUnique({ where: { id: orgId } }),
      );
      if (!org || org.isDeleted) {
        return res.status(404).json({
          success: false,
          error: 'NotFound',
          message: 'Organization not found',
        });
      }
      if (org.status !== 'ACTIVE') {
        return res.status(409).json({
          success: false,
          error: 'Conflict',
          message: `Cannot create user in organization with status=${org.status}`,
        });
      }

      const generatedPassword = input.password ? null : generatePassword();
      const plainPassword = input.password || generatedPassword;
      const passwordHash = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
      const providerId = input.providerId;
      // ── คอลัมน์ค้นหา: ต้องเขียน ไม่งั้นบัญชีล็อกอินไม่ได้ ─────────────────────
      //
      // ประตูล็อกอินค้นด้วย computeIdentifierHash() แล้วดูคอลัมน์ providerIdHash
      // (หรือ providerIdHmac เมื่อเปิดธง) ก่อน · ถ้าไม่เจอจึงตกไปเทียบ providerId
      // แบบข้อความ — แต่คอลัมน์นั้นถูกเข้ารหัสตอนเขียน (enc:) จึงไม่มีวันแมตช์
      //
      // เดิมประตูนี้ไม่เคยเขียน providerIdHash เลย (คอมเมนต์เดิมบอกเองว่า "this route
      // never wrote a lookup hash, and these accounts don't use the national-ID login
      // path") ผลคือ **ทุกบัญชีที่สร้างผ่านหน้าผู้ดูแล ล็อกอินไม่ได้เลยสักคน** — หน้าจอยื่น
      // รหัสผ่านชั่วคราวที่แสดงครั้งเดียวให้ แล้วบัญชีนั้นใช้ไม่ได้ตั้งแต่แรก
      // เจอตอนสร้างบัญชี demo ผ่าน UI จริง 2026-09-12
      //
      // ใช้ฟังก์ชันของ user-lookup-service เอง ไม่คำนวณซ้ำที่นี่ — มันเลือก SHA-256 หรือ
      // HMAC ด้วยธงตัวเดียวกับที่ฝั่งอ่านใช้ คนเขียนกับคนอ่านจึงดริฟต์กันไม่ได้
      const providerIdHash = computeIdentifierHash(providerId);

      // Detokenize STAGE 0 (RFC docs/handoffs/national-id-detokenize-rfc-2026-06-29.md):
      // when APP_FK_USE_TOKEN is ON, canonicalId becomes the keyed-HMAC token of
      // this synthetic providerId. We ALSO dual-write providerIdHmac to the same
      // value so the row stays consistent with the STAGE-A re-key
      // (canonicalId := COALESCE(healthIdHmac, providerIdHmac, id)) — otherwise a
      // NULL providerIdHmac would re-key this row to `id` and drift from the
      // value written here. Flag OFF → providerIdHmac stays null (byte-for-byte
      // today: this route never wrote a lookup hash, and these accounts don't use
      // the national-ID login path). The synthetic providerId is not PII; this is
      // purely FK-key consistency.
      const providerIdHmac = useFkToken() ? computeLookupHmac(providerId) : null;

      const created = await withoutTenantScope(() =>
        prisma.user.create({
          data: {
            email: input.email,
            password: passwordHash,
            firstName: input.firstName,
            lastName: input.lastName,
            phoneNumber: input.phoneNumber || null,
            // The zod enum stays UPPERCASE — that is the wire contract the
            // platform console sends. users.role is canonical (migration
            // 20260801000000), so the value is normalised on the way into the
            // column; writing the raw enum re-dirtied it and made the new
            // account invisible to every canonical role filter.
            role: normalizeRole(input.role),
            accountType: 'PROVIDER',
            authType: 'PROVIDER_ID',
            providerId,
            providerIdHash,
            providerIdHmac,
            canonicalId: resolveCanonicalIdForWrite({
              actualIdentifier: providerId,
              isProvider: true,
              precomputedHmac: providerIdHmac,
            }),
            status: 'ACTIVE',
            ministryVerified: true,
            ministryVerifiedAt: new Date(),
            isEmailVerified: false, // first login flow can verify
            organizationId: org.id,
            createdBy: req.user?.id || null,
          },
        }),
      );

      logger.info(
        `[org-user-create] org=${org.slug} userId=${created.id} role=${created.role} by=${req.user?.id}`,
      );

      // Strip secrets from response — never echo password or hash.
      const { password: _pw, idCardHash: _ich, healthIdHash: _hh, providerIdHash: _ph, taxIdHash: _th,
        twoFactorSecret: _tfs, twoFactorBackupCodes: _tfb, emailVerificationToken: _evt,
        passwordResetToken: _prt, ...safeUser } = created;

      return res.status(201).json({
        success: true,
        // Nested so the api-client's `data` unwrap keeps generatedPassword
        // and loginHint accessible to the frontend.
        data: {
          user: safeUser,
          // Returned ONCE — admin must record it before navigating away.
          generatedPassword,
          loginHint: {
            portal: 'PROVIDER',
            providerId: created.providerId,
            loginPath: '/api/auth/provider/login',
          },
        },
      });
    } catch (err) {
      if (err && err.code === 'P2002') {
        return res.status(409).json({
          success: false,
          error: 'Conflict',
          message: 'A user with that email or providerId already exists',
          target: err.meta?.target,
        });
      }
      logger.error('[org-user-create] failed:', err.message);
      return res.status(500).json({
        success: false,
        error: 'ServerError',
        message: 'Failed to create user',
      });
    }
  },
);

module.exports = router;
