/**
 * The 8-step golden path, per the work brief:
 *   เกษตรกรสมัคร -> ยื่นคำขอ -> ชำระค่าธรรมเนียมงวด 1 -> เจ้าหน้าที่ตรวจเอกสาร ->
 *   นัดตรวจประเมิน -> ผลตรวจผ่าน -> ออกใบรับรอง -> ผู้บริโภคสแกน QR ตรวจย้อนกลับ
 *
 * Every step performs REAL Playwright actions against the real page (click/
 * fill/goto) — see lib/ui-helpers.mjs and lib/auth-actions.mjs header comments.
 * A step returns { status: 'PASS'|'BLOCKED'|'FAIL', reason } itself (not
 * inferred by run.mjs) so the reasoning is explicit and auditable per step.
 *
 * DB tables snapshotted are exactly the 4 the project rules/PROMPT named:
 * applications, checkout_orders, audit_logs, certificates (lib/db.mjs
 * ALLOWED_TABLES, cited to the real @@map() lines in prisma/schema/*.prisma).
 */
import { AUTH_ROUTES } from './lib/ssot.mjs';
import { gotoAndLog, driveWizard, clickByRole } from './lib/ui-helpers.mjs';
import { loginFarmer, loginProvider } from './lib/auth-actions.mjs';
import { Blocked } from './lib/errors.mjs';

/** Thai national ID with a valid mod-11 check digit — same algorithm apps/web-app/e2e/e2e-golden-scenario.spec.ts uses for E2E fixture data (test-data generation, not a re-implementation of app validation logic). */
function generateThaiId() {
  const digits = [Math.floor(Math.random() * 8) + 1];
  for (let i = 1; i < 12; i += 1) digits.push(Math.floor(Math.random() * 10));
  const sum = digits.reduce((acc, d, i) => acc + d * (13 - i), 0);
  const check = (11 - (sum % 11)) % 10;
  return digits.join('') + String(check);
}

/**
 * apps/web-app/src/app/api/[...path]/route.ts's proxy answers with a
 * structured `{ code: 'BACKEND_UNREACHABLE' }` body (HTTP 503) when the
 * backend it forwards to is down — verified against a real captured
 * response during this harness's own dry-run appendix (evidence/flow-proof).
 * That is an infra signal, not an application bug, so it is classified
 * BLOCKED rather than FAIL even though the raw HTTP status is >=400.
 */
function isBackendUnreachableBody(resBody) {
  return !!resBody && typeof resBody === 'object' && resBody.code === 'BACKEND_UNREACHABLE';
}

function classifyByApi(calls, pattern, successStatuses) {
  const matched = calls.filter((c) => pattern.test(c.path));
  if (matched.length === 0) {
    return { status: 'BLOCKED', reason: `ไม่มี API call ที่ตรงกับ ${pattern} เกิดขึ้นระหว่าง step นี้` };
  }
  const last = matched[matched.length - 1];
  if (last.status == null) {
    return { status: 'BLOCKED', reason: `API call ${last.method} ${last.path} ไม่ได้รับ response จริง (network error: ${last.error || 'unknown'}) — สอดคล้องกับ backend ที่รันไม่ได้ในสภาพแวดล้อมนี้` };
  }
  if (isBackendUnreachableBody(last.resBody)) {
    return { status: 'BLOCKED', reason: `${last.method} ${last.path} -> HTTP ${last.status} BACKEND_UNREACHABLE (Next.js proxy เองรายงานว่า backend ไม่ตอบสนอง — infra, ไม่ใช่ bug ของ flow)` };
  }
  if (successStatuses.includes(last.status)) {
    return { status: 'PASS', reason: `${last.method} ${last.path} -> HTTP ${last.status}` };
  }
  return { status: 'FAIL', reason: `${last.method} ${last.path} -> HTTP ${last.status} (ไม่อยู่ใน success set ${JSON.stringify(successStatuses)})` };
}

function makeFarmerFixture() {
  const idCard = generateThaiId();
  const phone = `089${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
  const stamp = Date.now();
  return {
    identifier: idCard,
    firstName: 'สมชาย',
    lastName: 'ทดสอบไหลงาน',
    email: `flow-proof.${stamp}@example.invalid`,
    phone,
    password: 'FlowProof@12345',
  };
}

export const steps = [
  {
    seq: 1,
    id: 'farmer-register',
    title: 'เกษตรกรสมัคร (register)',
    roleLabel: 'เกษตรกร (ยังไม่ล็อกอิน)',
    dbTables: [],
    async perform(ctx) {
      const f = makeFarmerFixture();
      ctx.state.farmer = f;
      await gotoAndLog(ctx.page, ctx, AUTH_ROUTES.REGISTER_ROUTE, 'เปิดหน้าสมัครสมาชิก');
      await ctx.shot('01-register-loaded');

      const result = await driveWizard(ctx.page, ctx, {
        fieldValues: {
          'reg-identifier': f.identifier,
          'reg-firstName': f.firstName,
          'reg-lastName': f.lastName,
          'reg-email': f.email,
          'reg-phone': f.phone,
          'reg-password': f.password,
          'reg-confirm-password': f.password,
        },
        checkboxIds: ['reg-consent'],
        submitName: /สมัครสมาชิก|สมัคร|register|create account/i,
        nextName: /ถัดไป|next/i,
      });
      await ctx.shot('02-register-after-submit-attempt');

      if (!result.submitted) {
        throw new Blocked(`กรอกฟอร์มสมัครไม่จบ (หยุดที่หน้าจอ ${result.screensVisited}) — ${ctx.lastBlockedActionDetail() || 'ไม่พบปุ่ม submit/ถัดไป'}`);
      }

      const outcome = classifyByApi(ctx.getApiCalls(), /\/api\/auth\/health\/register/, [200, 201, 409]);
      ctx.state.farmerRegistered = outcome.status === 'PASS';
      return outcome;
    },
  },

  {
    seq: 2,
    id: 'farmer-submit-application',
    title: 'ยื่นคำขอ (submit application)',
    roleLabel: 'เกษตรกร',
    dbTables: [
      { table: 'applications', describe: 'คำขอของเกษตรกรคนนี้', resolve: (s) => (s.applicationId ? [{ column: 'id', value: s.applicationId }] : null) },
    ],
    async perform(ctx) {
      if (!ctx.state.farmerRegistered) {
        // Still attempt the real login click — a real, honest attempt, not skipped —
        // its failure is what BLOCKS this step, not an assumption.
        const login = await loginFarmer(ctx.page, ctx, ctx.state.farmer);
        await ctx.shot('01-farmer-login-attempt');
        if (!login.ok) {
          throw new Blocked(`login เกษตรกรไม่สำเร็จ (สมัครใน step ก่อนหน้าไม่ผ่าน): ${login.reason}`);
        }
        ctx.state.farmerLoggedIn = true;
      }

      await gotoAndLog(ctx.page, ctx, '/health/applications/new', 'เปิดหน้าเริ่มยื่นคำขอ');
      await ctx.shot('02-application-wizard-entry');

      const currentUrl = ctx.page.url();
      if (!currentUrl.includes('/health/applications/new')) {
        throw new Blocked(`ถูก redirect ออกจาก /health/applications/new ไป ${currentUrl} — session ไม่ผ่าน auth gate`);
      }

      // Best-effort: click whatever the primary CTA on this entry screen is
      // (exact wizard field set is out of this sandbox's verifiable reach —
      // see report "infra blockers"). A real click is still attempted.
      const advanced = await clickByRole(ctx.page, ctx, 'button', /เริ่ม|ถัดไป|next|start/i, 'ปุ่มเริ่ม/ถัดไปบนหน้าคำขอใหม่');
      await ctx.shot('03-application-after-first-click');
      if (!advanced) {
        throw new Blocked('ไม่พบปุ่มเริ่ม/ถัดไปที่กดได้จริงบนหน้าคำขอใหม่ในสถานะที่ backend ให้ข้อมูลมา (ตรวจ selector ซ้ำในสภาพแวดล้อมที่ backend ทำงาน)');
      }

      return classifyByApi(ctx.getApiCalls(), /\/api\/applications/, [200, 201]);
    },
  },

  {
    seq: 3,
    id: 'farmer-pay-phase1',
    title: 'ชำระค่าธรรมเนียมงวด 1',
    roleLabel: 'เกษตรกร',
    dbTables: [
      { table: 'checkout_orders', describe: 'รายการชำระเงินงวด 1', resolve: (s) => (s.applicationId ? [{ column: 'applicationId', value: s.applicationId }] : null) },
      { table: 'applications', describe: 'phase1Status ของคำขอ', resolve: (s) => (s.applicationId ? [{ column: 'id', value: s.applicationId }] : null) },
    ],
    async perform(ctx) {
      if (!ctx.state.applicationId) {
        throw new Blocked('ไม่มี applicationId จาก step ก่อนหน้า (ยื่นคำขอไม่สำเร็จ) — ไม่สามารถเปิดหน้าชำระเงินของคำขอจริงได้');
      }
      const url = `/health/payments/checkout?app=${encodeURIComponent(ctx.state.applicationId)}&milestone=M1`;
      await gotoAndLog(ctx.page, ctx, url, 'เปิดหน้าชำระเงินงวด 1');
      await ctx.shot('01-checkout-loaded');

      const clicked = await clickByRole(ctx.page, ctx, 'button', /เริ่มขั้นตอนชำระเงิน/i, 'เริ่มขั้นตอนชำระเงิน');
      await ctx.shot('02-checkout-after-click');
      if (!clicked) {
        throw new Blocked('ไม่พบปุ่ม "เริ่มขั้นตอนชำระเงิน" ที่กดได้จริงบนหน้า checkout ที่โหลดมา');
      }

      return classifyByApi(ctx.getApiCalls(), /\/api\/(payments\/checkout|checkout)/, [200, 201]);
    },
  },

  {
    seq: 4,
    id: 'reviewer-approve-docs',
    title: 'เจ้าหน้าที่ตรวจเอกสาร',
    roleLabel: 'ผู้ตรวจเอกสาร (document_reviewer)',
    dbTables: [
      { table: 'applications', describe: 'status หลังตรวจเอกสาร', resolve: (s) => (s.applicationId ? [{ column: 'id', value: s.applicationId }] : null) },
      { table: 'audit_logs', describe: 'log การอนุมัติเอกสาร', resolve: (s) => (s.applicationId ? [{ column: 'resourceId', value: s.applicationId }] : null) },
    ],
    async perform(ctx) {
      const id = process.env.FLOW_PROOF_REVIEWER_ID;
      const pw = process.env.FLOW_PROOF_REVIEWER_PW;
      if (!id || !pw) {
        throw new Blocked('ไม่มี FLOW_PROOF_REVIEWER_ID/FLOW_PROOF_REVIEWER_PW — ไม่เดารหัสผ่าน (ตามกฎเดียวกับ e2e-walkthrough kit)');
      }
      const login = await loginProvider(ctx.page, ctx, { identifier: id, password: pw }, 'reviewer');
      await ctx.shot('01-reviewer-login-attempt');
      if (!login.ok) throw new Blocked(`login reviewer ไม่สำเร็จ: ${login.reason}`);

      if (!ctx.state.applicationId) {
        throw new Blocked('login reviewer สำเร็จ แต่ไม่มี applicationId จาก step ก่อนหน้าให้เปิดตรวจ');
      }
      await gotoAndLog(ctx.page, ctx, `/provider/applications/${ctx.state.applicationId}`, 'เปิดคำขอที่ต้องตรวจเอกสาร');
      await ctx.shot('02-reviewer-application-detail');
      const clicked = await clickByRole(ctx.page, ctx, 'button', /อนุมัติเอกสาร|approve/i, 'อนุมัติเอกสาร');
      await ctx.shot('03-reviewer-after-approve-click');
      if (!clicked) throw new Blocked('ไม่พบปุ่มอนุมัติเอกสารที่กดได้จริงบนหน้ารายละเอียดคำขอ');

      return classifyByApi(ctx.getApiCalls(), /\/api\/applications\/.+\/status/, [200]);
    },
  },

  {
    seq: 5,
    id: 'scheduler-assign-audit',
    title: 'นัดตรวจประเมิน (schedule audit)',
    roleLabel: 'ผู้จัดตารางนัดหมาย (scheduler)',
    dbTables: [
      { table: 'audit_logs', describe: 'log การนัดตรวจประเมิน', resolve: (s) => (s.applicationId ? [{ column: 'resourceId', value: s.applicationId }] : null) },
    ],
    async perform(ctx) {
      const id = process.env.FLOW_PROOF_SCHEDULER_ID;
      const pw = process.env.FLOW_PROOF_SCHEDULER_PW;
      if (!id || !pw) throw new Blocked('ไม่มี FLOW_PROOF_SCHEDULER_ID/FLOW_PROOF_SCHEDULER_PW — ไม่เดารหัสผ่าน');
      const login = await loginProvider(ctx.page, ctx, { identifier: id, password: pw }, 'scheduler');
      await ctx.shot('01-scheduler-login-attempt');
      if (!login.ok) throw new Blocked(`login scheduler ไม่สำเร็จ: ${login.reason}`);

      await gotoAndLog(ctx.page, ctx, '/provider/scheduler/queue', 'เปิดคิวนัดตรวจประเมิน');
      await ctx.shot('02-scheduler-queue');
      if (!ctx.state.applicationId) {
        throw new Blocked('login scheduler สำเร็จ แต่ไม่มี applicationId จาก step ก่อนหน้าให้ค้นหาในคิว');
      }
      const clicked = await clickByRole(ctx.page, ctx, 'button', /นัดหมาย|มอบหมาย|assign/i, 'มอบหมาย/นัดตรวจ');
      await ctx.shot('03-scheduler-after-click');
      if (!clicked) throw new Blocked('ไม่พบปุ่มนัดหมาย/มอบหมายที่กดได้จริงในคิว (อาจเพราะคำขอนี้ไม่ปรากฏในคิว — ต้นทางถูก BLOCKED มาก่อน)');

      return classifyByApi(ctx.getApiCalls(), /\/api\/(audits|scheduler)/, [200, 201]);
    },
  },

  {
    seq: 6,
    id: 'auditor-pass',
    title: 'ผลตรวจผ่าน (audit pass)',
    roleLabel: 'ผู้ตรวจประเมินพื้นที่ (auditor)',
    dbTables: [
      { table: 'audit_logs', describe: 'log ผลตรวจประเมิน', resolve: (s) => (s.applicationId ? [{ column: 'resourceId', value: s.applicationId }] : null) },
      { table: 'applications', describe: 'status หลังผลตรวจผ่าน', resolve: (s) => (s.applicationId ? [{ column: 'id', value: s.applicationId }] : null) },
    ],
    async perform(ctx) {
      const id = process.env.FLOW_PROOF_AUDITOR_ID;
      const pw = process.env.FLOW_PROOF_AUDITOR_PW;
      if (!id || !pw) throw new Blocked('ไม่มี FLOW_PROOF_AUDITOR_ID/FLOW_PROOF_AUDITOR_PW — ไม่เดารหัสผ่าน');
      const login = await loginProvider(ctx.page, ctx, { identifier: id, password: pw }, 'auditor');
      await ctx.shot('01-auditor-login-attempt');
      if (!login.ok) throw new Blocked(`login auditor ไม่สำเร็จ: ${login.reason}`);

      if (!ctx.state.applicationId) throw new Blocked('login auditor สำเร็จ แต่ไม่มี applicationId ให้เปิดบันทึกผลตรวจ');
      await gotoAndLog(ctx.page, ctx, `/provider/audits/${ctx.state.applicationId}/inspect`, 'เปิดหน้าบันทึกผลตรวจประเมิน');
      await ctx.shot('02-auditor-inspect');
      const clicked = await clickByRole(ctx.page, ctx, 'button', /ผ่าน|pass|approve/i, 'บันทึกผลตรวจ = ผ่าน');
      await ctx.shot('03-auditor-after-click');
      if (!clicked) throw new Blocked('ไม่พบปุ่มบันทึกผลตรวจ (ผ่าน) ที่กดได้จริงบนหน้า inspect');

      return classifyByApi(ctx.getApiCalls(), /\/api\/audits/, [200, 201]);
    },
  },

  {
    seq: 7,
    id: 'issue-certificate',
    title: 'ออกใบรับรอง (issue certificate)',
    roleLabel: 'ผู้ดูแลระบบ/บัญชี (admin)',
    dbTables: [
      { table: 'certificates', describe: 'ใบรับรองที่ออก', resolve: (s) => (s.applicationId ? [{ column: 'applicationId', value: s.applicationId }] : null) },
      { table: 'applications', describe: 'status สุดท้ายของคำขอ', resolve: (s) => (s.applicationId ? [{ column: 'id', value: s.applicationId }] : null) },
    ],
    async perform(ctx) {
      const id = process.env.FLOW_PROOF_ADMIN_ID;
      const pw = process.env.FLOW_PROOF_ADMIN_PW;
      if (!id || !pw) throw new Blocked('ไม่มี FLOW_PROOF_ADMIN_ID/FLOW_PROOF_ADMIN_PW — ไม่เดารหัสผ่าน');
      const login = await loginProvider(ctx.page, ctx, { identifier: id, password: pw }, 'admin');
      await ctx.shot('01-admin-login-attempt');
      if (!login.ok) throw new Blocked(`login admin ไม่สำเร็จ: ${login.reason}`);

      await gotoAndLog(ctx.page, ctx, '/provider/certificates', 'เปิดหน้าออกใบรับรอง');
      await ctx.shot('02-certificates-list');
      if (!ctx.state.applicationId) throw new Blocked('login admin สำเร็จ แต่ไม่มี applicationId ให้ออกใบรับรอง');
      const clicked = await clickByRole(ctx.page, ctx, 'button', /ออกใบรับรอง|issue/i, 'ออกใบรับรอง');
      await ctx.shot('03-certificates-after-click');
      if (!clicked) throw new Blocked('ไม่พบปุ่มออกใบรับรองที่กดได้จริง (อาจเพราะคำขอนี้ยังไม่ถึงสถานะที่ออกใบรับรองได้ — ต้นทางถูก BLOCKED มาก่อน)');

      return classifyByApi(ctx.getApiCalls(), /\/api\/certificates/, [200, 201]);
    },
  },

  {
    seq: 8,
    id: 'consumer-trace',
    title: 'ผู้บริโภคสแกน QR ตรวจย้อนกลับ',
    roleLabel: 'สาธารณะ (ไม่ต้องล็อกอิน)',
    dbTables: [
      { table: 'certificates', describe: 'ใบรับรองที่ query.code อ้างถึง (read-only, ไม่ควรมี diff)', resolve: (s) => (s.certificateNumber ? [{ column: 'certificateNumber', value: s.certificateNumber }] : null) },
    ],
    async perform(ctx) {
      const code = ctx.state.certificateNumber || 'FLOW-PROOF-DEMO-CODE';
      await gotoAndLog(ctx.page, ctx, `/trace/${encodeURIComponent(code)}`, 'เปิดหน้า trace แบบสาธารณะ (จำลอง QR scan)');
      await ctx.shot('01-trace-page');
      const bodyText = await ctx.page.locator('body').textContent().catch(() => '');
      if (!bodyText || bodyText.trim().length === 0) {
        throw new Blocked('หน้า /trace/[code] ไม่ render เนื้อหาใด ๆ เลย');
      }
      if (!ctx.state.certificateNumber) {
        return { status: 'BLOCKED', reason: 'ไม่มีเลขใบรับรองจริงจาก step ก่อนหน้า จึงทดสอบได้แค่ path ตัวอย่าง (คาดว่าเป็น not-found) — ไม่ใช่การพิสูจน์ lookup จริง' };
      }
      return classifyByApi(ctx.getApiCalls(), /\/api\/trace/, [200]);
    },
  },
];
