/**
 * Notification Fanout Service — Iter 23 (Refund + transport wiring).
 *
 * External-services cleanup, Task 2 (2026-08-19, operator decision
 * 2026-08-13, `shared/notification-view.js:16-19`): the EMAIL and SMS
 * dispatch legs were retired from this dispatcher — the in-app Notification
 * row is now the only channel actually sent. `channels` arrays that still
 * name 'EMAIL'/'SMS' (some callers pass ['IN_APP','EMAIL','SMS'] explicitly,
 * e.g. refund-service.js; others omit `channels`
 * entirely — audit-onsite-service.js, audit-scheduling-service.js,
 * renewal-reminder-cron.js — and get the ALL_CHANNELS default below, which
 * is IN_APP-only) are accepted for call-site compatibility; explicit
 * EMAIL/SMS entries come back
 * `{ ok:false, skipped:'CHANNEL_RETIRED' }` instead of dispatching. The
 * template registry below still builds email/SMS-shaped bodies
 * (bodyTHHtml/smsTH) — nothing consumes them today. T3 (external-services
 * cleanup) shipped without deleting these dead fields; they remain dead
 * weight, tracked in the backlog (final-fix-1 ruling, 2026-08-19) —
 * not merge-blocking.
 *
 * Why a separate fanout layer rather than extending notification-service.js
 * in place: notification-service.js is consumed by ~12 caller sites today.
 * A re-wire there would force every caller into the new transport API on
 * the same release, which is too wide a blast radius for Iter 23. Instead,
 * new caller sites (starting with refund-service in this batch) adopt the
 * fanout layer directly; existing sites can migrate incrementally without
 * breaking on the dispatcher.
 *
 * Public surface:
 *   - send({ userId, type, payload, channels }) → fanned-out dispatch
 *       results across IN_APP (dispatched) + EMAIL / SMS (retired — see
 *       above), with a 60-min dedupe window keyed by (userId, type,
 *       applicationId, invoiceId, period).
 *   - getTemplateForType(type) → returns the Thai/English template bundle
 *       used by send() to render channel-specific copy.
 *
 * Dedupe semantics: a sha256 hash of (userId|type|applicationId|invoiceId
 * |period) is the key. The same key dispatched within 60 minutes returns
 * the FIRST dispatch result and skips the channels. R5-A wired this to
 * Redis (`SET notify:dedupe:<hash> <result> EX 3600 NX`) so dedupe holds
 * across Node processes / pods. A per-process Map shim remains ONLY for
 * graceful degradation when `redisService.isAvailable()` is false (dev
 * environments without Redis) — production deployments MUST have Redis.
 *
 * Buddhist-Era date formatting: all Thai-language templates that include
 * a date pass through `Intl.DateTimeFormat('th-TH', { era: 'long' })`
 * which yields year+543 in Buddhist Era + Thai era marker (e.g.
 * "16 พฤษภาคม 2569" rather than "16 May 2026").
 *
 * @module services/notification-fanout-service
 */

'use strict';

const crypto = require('crypto');
const logger = require('../shared/logger');

let prismaModule;
try {
    prismaModule = require('./prisma-database');
} catch (_e) {
    prismaModule = { prisma: null };
}

const notificationService = require('./notification-service');
const redisService = require('./redis-service');
const { DEFAULT_TIME_ZONE, formatLocalTime } = require('../utils/working-days');
const { formatThaiDateFull } = require('../utils/thai-format');

// ── Constants ──────────────────────────────────────────────────────────────

// Task 2 (external-services cleanup): business notifications are IN_APP-only
// in code now. CHANNELS/ALL_CHANNELS no longer expose EMAIL/SMS — the
// fanout severed its use of the email/SMS transports entirely (T3 deletes
// the transport modules themselves in a later task).
const CHANNELS = Object.freeze({
    IN_APP: 'IN_APP',
});
const ALL_CHANNELS = Object.freeze([CHANNELS.IN_APP]);

// Channel names retired from dispatch but still accepted on the `channels`
// array so callers that still pass EMAIL/SMS explicitly (['IN_APP','EMAIL',
// 'SMS']) stay valid without edits; callers that omit `channels` never see
// these — they get the ALL_CHANNELS default (IN_APP-only) instead — see
// _runChannels().
const RETIRED_CHANNELS = Object.freeze(['EMAIL', 'SMS']);

// 60-minute dedupe window — same key, same payload identity ⇒ collapse.
const DEDUPE_WINDOW_MS = 60 * 60 * 1000;
const DEDUPE_TTL_SECONDS = Math.floor(DEDUPE_WINDOW_MS / 1000);

// Redis namespace for the dedupe slot. R5-A: this replaces the previous
// in-process Map so dedupe holds across Node processes / pods.
const DEDUPE_KEY_PREFIX = 'notify:dedupe:';

// Sentinel stored in the dedupe slot while a dispatch is in flight. A
// second caller that loses the NX race polls until the slot transitions
// from this sentinel to the final dispatch result. Choosing a sentinel
// (rather than overwriting with the final result post-dispatch) is what
// makes the dedupe atomic: a concurrent send() blocks the duplicate
// dispatch immediately rather than after the first one finishes.
const DEDUPE_INFLIGHT_SENTINEL = '__INFLIGHT__';
const DEDUPE_POLL_INTERVAL_MS = 25;
const DEDUPE_POLL_MAX_MS = 5000;

// In-process Map shim used ONLY when redisService.isAvailable() is false
// (dev environments without Redis, plus unit tests that don't mock Redis).
// Mirrors the prune-on-write semantics of the previous Map-only path so the
// graceful-degraded path stays bounded.
const _fallbackDedupeStore = new Map();
let _warnedRedisUnavailable = false;

function _pruneFallback(now = Date.now()) {
    for (const [k, v] of _fallbackDedupeStore) {
        if (now - v.timestamp > DEDUPE_WINDOW_MS) {_fallbackDedupeStore.delete(k);}
    }
}

function _makeDedupeKey({ userId, type, payload }) {
    const period = payload?.period || '';
    const applicationId = payload?.applicationId || '';
    const invoiceId = payload?.invoiceId || '';
    const certNumber = payload?.certNumber || '';
    const raw = `${userId}|${type}|${applicationId}|${invoiceId}|${certNumber}|${period}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
}

function _makeRedisKey(dedupeKey) {
    return `${DEDUPE_KEY_PREFIX}${dedupeKey}`;
}

function _redisAvailable() {
    return Boolean(redisService && typeof redisService.isAvailable === 'function' && redisService.isAvailable());
}

function _warnRedisUnavailableOnce() {
    if (_warnedRedisUnavailable) {return;}
    _warnedRedisUnavailable = true;
    logger.warn('[fanout] Redis unavailable — degrading to per-process dedupe Map');
}

/**
 * Look up the raw current value of the dedupe slot. Returns the sentinel
 * string when a dispatch is in flight, the result object when a final
 * result has been written, or null when no slot exists.
 *
 * When Redis is available, reads from `notify:dedupe:<hash>`. Otherwise
 * falls back to the in-process Map shim (logs a single warn per process).
 */
async function _getDedupeResult(dedupeKey) {
    if (_redisAvailable()) {
        try {
            const cached = await redisService.get(_makeRedisKey(dedupeKey));
            return cached === undefined ? null : cached;
        } catch (err) {
            logger.warn(`[fanout] Redis GET error for dedupe key ${dedupeKey}: ${err?.message}`);
            return null;
        }
    }
    _warnRedisUnavailableOnce();
    _pruneFallback();
    const entry = _fallbackDedupeStore.get(dedupeKey);
    if (entry && Date.now() - entry.timestamp <= DEDUPE_WINDOW_MS) {
        return entry.result;
    }
    return null;
}

/**
 * Atomically claim the dedupe slot. Returns true when this caller WROTE
 * the slot (was first), false when a concurrent caller already wrote.
 *
 * When Redis is available, uses SET EX <ttl> NX. Otherwise the in-process
 * Map shim simulates the same single-writer semantics with a per-key check.
 */
async function _claimDedupeSlot(dedupeKey, value) {
    if (_redisAvailable()) {
        return redisService.setNX(_makeRedisKey(dedupeKey), value, DEDUPE_TTL_SECONDS);
    }
    _warnRedisUnavailableOnce();
    if (_fallbackDedupeStore.has(dedupeKey)) {return false;}
    _fallbackDedupeStore.set(dedupeKey, { timestamp: Date.now(), result: value });
    return true;
}

/**
 * Overwrite the dedupe slot with the final dispatch result (after the
 * caller's atomic claim succeeded). Uses the non-atomic SET so the
 * sentinel value is replaced by the final result.
 */
async function _writeDedupeResult(dedupeKey, result) {
    if (_redisAvailable()) {
        try {
            await redisService.set(_makeRedisKey(dedupeKey), result, DEDUPE_TTL_SECONDS);
        } catch (err) {
            logger.warn(`[fanout] Redis SET error for dedupe key ${dedupeKey}: ${err?.message}`);
        }
        return;
    }
    _fallbackDedupeStore.set(dedupeKey, { timestamp: Date.now(), result });
}

/**
 * Wait for the in-flight slot to transition from the sentinel to the
 * final dispatch result. Used by callers that lost the NX race so they
 * can return the winner's result rather than dispatching again.
 */
async function _waitForResult(dedupeKey) {
    const deadline = Date.now() + DEDUPE_POLL_MAX_MS;
    while (Date.now() < deadline) {
        const cur = await _getDedupeResult(dedupeKey);
        if (cur && cur !== DEDUPE_INFLIGHT_SENTINEL) {return cur;}
        await new Promise((r) => setTimeout(r, DEDUPE_POLL_INTERVAL_MS));
    }
    return null;
}

// ── Thai/BE date + currency helpers ────────────────────────────────────────
//
// Every date and time a notification prints is Bangkok time, named here, not
// the process clock's zone (UTC in the containers). A 09:00 Bangkok audit is
// stored as 02:00Z; without the zone the SMS said "02:00 น." (review
// 2026-09-26, operator ruling "เวลาไทยทั้งหมด").

function formatBE(date) {
    if (!date) {return '';}
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) {return '';}
    try {
        return new Intl.DateTimeFormat('th-TH', {
            year: 'numeric', month: 'long', day: 'numeric', era: 'long',
            timeZone: DEFAULT_TIME_ZONE,
        }).format(d);
    } catch (_e) {
        // Fallback for environments without Intl.DateTimeFormat full support
        return formatThaiDateFull(d);
    }
}

function formatBETime(date) {
    if (!date) {return '';}
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) {return '';}
    try {
        return new Intl.DateTimeFormat('th-TH', {
            hour: '2-digit', minute: '2-digit', hour12: false,
            timeZone: DEFAULT_TIME_ZONE,
        }).format(d);
    } catch (_e) {
        return formatLocalTime(d);
    }
}

function formatTHB(amount) {
    const n = Number(amount) || 0;
    return n.toLocaleString('th-TH', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
}

// Every value interpolated into an email body goes through here — not only the
// free-text ones. Added at R4 review M-1 for operator free-text, widened
// 2026-09-08 when the request boundary stopped rewriting input (operator ruling:
// "ปล่อยผ่านแล้ว escape ตอนแสดงผล"). Until then `auditorName` reached the
// applicant's inbox raw, and the only thing standing between a staff display
// name and an <a href> in a government email was a regex at the front door that
// also ate ordinary Thai text. Identifiers like applicationNumber are escaped
// too: "this one is system-generated" is a fact about today's callers, not a
// property of this function, and it is the kind of fact that quietly stops being
// true. The deliberate HTML fragments (findingsHtml) stay raw and escape their
// own contents at the point they are built.
// Mirrors the 5-char map used by pdf-generator.service.escapeHtml. Kept
// module-private so we don't add a public surface for templates to skip.
function _escHtml(value) {
    if (value === null || value === undefined) {return '';}
    const s = String(value);
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ── Template registry ──────────────────────────────────────────────────────

/**
 * Templates for the channels supported by Iter 23. Each entry is a pure
 * function `(payload) → { subjectTH, subjectEN, bodyTHHtml, bodyTHText,
 * smsTH }`. Templates intentionally do NOT include HTML <html>/<head>
 * boilerplate — the email transport (once provisioned) wraps a single
 * brand template around `bodyTHHtml` so style is centralised.
 *
 * Legacy templates registered in notification-service.js NotifyTemplates
 * still drive the in-app bell row (so the bell copy is identical to
 * today). This registry is ADDITIVE — email + SMS gain coverage without
 * disturbing in-app.
 *
 * Refund-flow legal basis cited in the email body:
 *   - ม.86/10 ป.รัษฎากร — ใบลดหนี้ accompanies the refund.
 *   - ม.86/4 ป.รัษฎากร — 7-year retention applies to the CN evidence.
 */
const TEMPLATES = Object.freeze({
    REFUND_INITIATED: (p = {}) => {
        const invoiceNumber = p.invoiceNumber || '-';
        const amountText = formatTHB(p.amount);
        const businessDays = p.businessDays || 7;
        const creditNoteNumber = p.creditNoteNumber || '-';
        return {
            subjectTH: `การคืนเงิน ${invoiceNumber} กำลังดำเนินการ`,
            subjectEN: `Refund initiated for invoice ${invoiceNumber}`,
            bodyTHHtml:
                `<p>เรียนผู้สมัคร,</p>`
                + `<p>การคืนเงินของท่านสำหรับใบกำกับภาษีเลขที่ <strong>${_escHtml(invoiceNumber)}</strong> `
                + `กำลังดำเนินการ จำนวน <strong>${_escHtml(amountText)} บาท</strong> `
                + `จะถูกคืนภายใน ${_escHtml(businessDays)} วันทำการ ผ่านการโอนเข้าบัญชีธนาคารของท่าน.</p>`
                + `<p>ใบลดหนี้ (Credit Note) เลขที่: <strong>${_escHtml(creditNoteNumber)}</strong> `
                + `ออกตามมาตรา 86/10 แห่งประมวลรัษฎากร</p>`
                + `<p>ขอบคุณค่ะ<br/>ทีมการเงิน GACP</p>`,
            bodyTHText:
                `การคืนเงินของท่านสำหรับใบกำกับภาษีเลขที่ ${invoiceNumber} `
                + `จำนวน ${amountText} บาท จะถูกคืนภายใน ${businessDays} วันทำการ. `
                + `ใบลดหนี้เลขที่ ${creditNoteNumber} (ม.86/10).`,
            smsTH:
                `การคืนเงินของท่าน ${invoiceNumber} กำลังดำเนินการ จำนวน ${amountText} บาท `
                + `จะถูกคืนภายใน ${businessDays} วันทำการ`,
        };
    },

    // ── Iter R4 / R4-C — PDPA erasure templates ─────────────────────────
    // These two templates share legal-basis citations (PDPA ม.32 /
    // ม.87/3 ป.รัษฎากร) and feed pdpa-erasure-service, whose confirm/
    // executed notifications route through the in-app leg (email/SMS
    // dispatch retired — see the module header). External-services
    // cleanup Task 4 (2026-08-19) deleted the third template in this
    // cluster, BREACH_NOTIFICATION_SUBJECT: zero production caller ever
    // passed `type: 'BREACH_NOTIFICATION_SUBJECT'` to send() or
    // getTemplateForType() — breach-notification-service.js does not
    // exist in this codebase.
    //
    // PII-leak invariant: rendered bodies MUST NOT echo raw phone numbers
    // (>=10 consecutive digits) or raw email addresses. Templates here
    // intentionally consume ONLY non-PII placeholders (requestId, token,
    // dates, structured category strings). The PDPA ม.32 right
    // is exercised by the subject — they already know their own PII; the
    // email is a workflow trigger, not a data disclosure.

    PDPA_ERASURE_REQUESTED: (p = {}) => {
        const requestId = p.requestId || '-';
        const token = p.token || '';
        const webBaseUrl = p.webBaseUrl || '[WEB_BASE_URL_NOT_CONFIGURED]';
        const expiresAtBE = p.expiresAt ? formatBE(p.expiresAt) : '';
        const expiresAtTime = p.expiresAt ? formatBETime(p.expiresAt) : '';
        // R4 review M-4: encodeURIComponent the query values so a future
        // requestId format change that includes '&', '+', '/' or '=' cannot
        // produce a broken URL or interpret a value char as a separator.
        // final-fix-1: callers that already compose this URL themselves
        // (pdpa-erasure-service.js) pass it as `p.actionUrl` — prefer that so
        // the composition logic lives in one place; fall back to composing
        // it here for callers that invoke this template directly (tests,
        // future callers) without an `actionUrl`.
        const confirmUrl = p.actionUrl || (`${webBaseUrl}/health/account/erasure`
            + `?requestId=${encodeURIComponent(requestId)}`
            + `&token=${encodeURIComponent(token)}`);
        return {
            subjectTH: `ยืนยันคำขอลบบัญชี (PDPA ม.32)`,
            subjectEN: `Confirm account erasure request (PDPA s.32)`,
            bodyTHHtml:
                `<p>เรียนเจ้าของข้อมูล,</p>`
                + `<p>ระบบได้รับคำขอใช้สิทธิ์ลบบัญชีของท่านตาม `
                + `<strong>พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล มาตรา 32</strong> `
                + `(สิทธิในการขอให้ลบหรือทำลายข้อมูล) เรียบร้อยแล้ว.</p>`
                + `<p>เลขที่คำขอ: <strong>${_escHtml(requestId)}</strong></p>`
                + `<p>กรุณายืนยันคำขอภายใน <strong>24 ชั่วโมง</strong> `
                + (expiresAtBE ? `(หมดอายุ ${_escHtml(expiresAtBE)} เวลา ${_escHtml(expiresAtTime)} น.) ` : '')
                + `โดยคลิกลิงก์ด้านล่าง:</p>`
                + `<p><a href="${_escHtml(confirmUrl)}">${_escHtml(confirmUrl)}</a></p>`
                + `<p>หากท่านไม่ได้เป็นผู้ส่งคำขอนี้ กรุณายกเลิกคำขอผ่านลิงก์ด้านบน `
                + `หรือเพิกเฉยต่อการแจ้งเตือนนี้ คำขอจะหมดอายุโดยอัตโนมัติ.</p>`
                + `<p>โปรดทราบ: บางข้อมูล (ใบกำกับภาษี, สมุดรายวัน, ใบรับรอง) `
                + `จะถูกเก็บรักษาต่อตาม <strong>ม.87/3 ประมวลรัษฎากร</strong> `
                + `(เก็บรักษา 7 ปี) และจะถูกทำให้ไม่ระบุตัวบุคคล (Anonymise) แทนการลบ.</p>`
                + `<p>ทีม GACP</p>`,
            bodyTHText:
                `ยืนยันคำขอลบบัญชี (PDPA ม.32) เลขที่ ${requestId}. `
                + `กรุณายืนยันภายใน 24 ชั่วโมง`
                + (expiresAtBE ? ` (หมดอายุ ${expiresAtBE} ${expiresAtTime} น.)` : '')
                + ` ผ่านลิงก์: ${confirmUrl}. `
                + `หากท่านไม่ได้เป็นผู้ส่งคำขอ กรุณาเพิกเฉยการแจ้งเตือนนี้.`,
            smsTH:
                `คำขอลบบัญชี GACP (ม.32) เลขที่ ${requestId} `
                + `กรุณากดปุ่มยืนยันในการแจ้งเตือนนี้ภายใน 24 ชม.`,
        };
    },

    PDPA_ERASURE_EXECUTED: (p = {}) => {
        const executedAtBE = p.executedAt ? formatBE(p.executedAt) : '';
        const executedAtTime = p.executedAt ? formatBETime(p.executedAt) : '';
        return {
            subjectTH: `คำขอลบบัญชีของท่านเสร็จสมบูรณ์`,
            subjectEN: `Account erasure completed`,
            bodyTHHtml:
                `<p>เรียนเจ้าของข้อมูล,</p>`
                + `<p>คำขอใช้สิทธิ์ลบบัญชีของท่านตาม `
                + `<strong>พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล มาตรา 32</strong> `
                + `ดำเนินการเสร็จสมบูรณ์`
                + (executedAtBE ? ` เมื่อวันที่ ${_escHtml(executedAtBE)} เวลา ${_escHtml(executedAtTime)} น.` : '')
                + `.</p>`
                + `<p><strong>ข้อมูลที่ถูกทำให้ไม่ระบุตัวบุคคล (Anonymised) ตาม ม.32:</strong></p>`
                + `<ul>`
                + `<li>บัญชีผู้ใช้ (User): ชื่อ-นามสกุล, อีเมล, เบอร์โทร, ที่อยู่, เลขประจำตัวประชาชน `
                + `และข้อมูลส่วนบุคคลอื่น ๆ ถูกลบหรือแทนที่ด้วยค่าระบุว่า "PDPA_ERASED"</li>`
                + `<li>คำขอรับรอง (Application): ข้อมูล PII ใน formData ถูกลบ แต่เลขที่คำขอยังคงอยู่</li>`
                + `<li>ใบรับรอง (Certificate): ชื่อผู้ขอ + ที่อยู่ ถูกทำให้ไม่ระบุตัวบุคคล `
                + `แต่เลขที่ใบรับรอง + วันที่ ยังคงอยู่เพื่อการตรวจสอบ QR code</li>`
                + `</ul>`
                + `<p><strong>ข้อมูลที่ถูกเก็บรักษาต่อ (Preserved) ตาม ม.87/3 ประมวลรัษฎากร `
                + `(เก็บรักษา 7 ปี) และพระราชบัญญัติว่าด้วยธุรกรรมทางอิเล็กทรอนิกส์ §31:</strong></p>`
                + `<ul>`
                + `<li>Invoice (ใบกำกับภาษี)</li>`
                + `<li>CreditNote (ใบลดหนี้)</li>`
                + `<li>DebitNote (ใบเพิ่มหนี้)</li>`
                + `<li>JournalEntry / JournalLine (สมุดรายวัน)</li>`
                + `<li>PaymentTransaction (หลักฐานการชำระเงิน)</li>`
                + `<li>AuditLog (บันทึกการตรวจสอบที่เก็บแบบ hash chain)</li>`
                + `</ul>`
                + `<p><strong>ข้อมูลที่ถูกลบโดยสมบูรณ์ (Erased):</strong></p>`
                + `<ul>`
                + `<li>ApplicationDraft (ร่างคำขอที่ยังไม่ส่ง)</li>`
                + `<li>Notification (การแจ้งเตือนภายในระบบ)</li>`
                + `<li>Session token / Refresh token / Consent cookie</li>`
                + `</ul>`
                + `<p>หากท่านมีข้อสงสัยเกี่ยวกับการเก็บรักษาข้อมูล กรุณาติดต่อ DPO ผ่านช่องทางที่ระบุในเว็บไซต์.</p>`
                + `<p>ทีม GACP</p>`,
            bodyTHText:
                `คำขอลบบัญชีของท่าน (PDPA ม.32) เสร็จสมบูรณ์`
                + (executedAtBE ? ` เมื่อ ${executedAtBE} ${executedAtTime} น.` : '')
                + `. ข้อมูลส่วนบุคคลถูกทำให้ไม่ระบุตัวบุคคล (Anonymised). `
                + `ใบกำกับภาษี, สมุดรายวัน, AuditLog ถูกเก็บรักษาต่อตาม ม.87/3 ประมวลรัษฎากร `
                + `(7 ปี). ApplicationDraft + Notification ถูกลบโดยสมบูรณ์.`,
            smsTH:
                `คำขอลบบัญชี GACP (ม.32) เสร็จสมบูรณ์. `
                + `ข้อมูลภาษีถูกเก็บรักษาตาม ม.87/3 ป.รัษฎากร 7 ปี`,
        };
    },

    // V1-C / D10 — applicant fanout for AUDIT_PASSED transitions.
    //
    // Applicants previously had to refresh /health/applications to discover
    // that their on-site audit had passed (and a certificate had been auto-
    // issued by the cert-hook). The cert-hook now dispatches this template
    // BEST-EFFORT inside application-status-writer.js after a successful
    // AUDIT_PASSED transition (independent of whether the cert was just
    // generated or short-circuited via the dedupe probe).
    //
    // Payload contract:
    //   - applicationNumber (string) — for the bell-row title.
    //   - certificateNumber (string?) — เดิมมีค่าเสมอ เพราะใบรับรองถูกออกใน hook เดียวกับ
    //     การเขียน AUDIT_PASSED · F-CERT-SOD (2026-09-10) ย้ายการออกใบไปที่ APPROVED ⇒
    //     ที่ข้อความนี้ยิง ใบ "ยังไม่มี" ตามปกติ และค่านี้จะว่างเป็นเรื่องธรรมดา
    //     ค่าที่ยังมีได้คือกรณีคำขอเดิมถือใบอยู่แล้ว (dedupe probe เจอของเก่า)
    APPLICANT_AUDIT_PASSED: (p = {}) => {
        const applicationNumber = p.applicationNumber || '-';
        const certificateNumber = p.certificateNumber || '';
        // ข้อความนี้เคยบอกว่า "ระบบกำลังออกใบรับรอง GACP" ทั้งที่ยังไม่มีใครตัดสินให้การ
        // รับรอง · หลัง F-CERT-SOD การตรวจผ่านคือ "ผ่านการประเมิน" ไม่ใช่ "ได้ใบ" —
        // ระหว่างสองอย่างนี้มีการตัดสินของเจ้าหน้าที่อีกคนคั่นอยู่ (ISO/IEC 17065 §7.6)
        // บอกตามจริงว่ารออะไร ดีกว่าบอกว่ากำลังได้สิ่งที่ยังไม่มีใครอนุมัติ
        const nextStepTH = 'คำขอของท่านอยู่ระหว่างการพิจารณาตัดสินให้การรับรอง '
            + 'ระบบจะแจ้งอีกครั้งเมื่อมีการออกใบรับรอง';
        return {
            subjectTH: `การตรวจประเมินผ่านแล้ว คำขอ ${applicationNumber}`,
            subjectEN: `On-site audit passed — application ${applicationNumber}`,
            bodyTHHtml:
                `<p>เรียนผู้สมัคร,</p>`
                + `<p>การตรวจประเมินฟาร์มของท่านสำหรับคำขอ `
                + `<strong>${_escHtml(applicationNumber)}</strong> <em>ผ่านแล้ว</em>.</p>`
                + (certificateNumber
                    ? `<p>คำขอนี้มีใบรับรอง GACP เลขที่ <strong>${_escHtml(certificateNumber)}</strong> `
                      + `ท่านสามารถดาวน์โหลดได้ที่หน้ารายการใบรับรอง.</p>`
                    : `<p>${nextStepTH}.</p>`),
            bodyTHText:
                `การตรวจประเมินฟาร์มของคำขอ ${applicationNumber} ผ่านแล้ว.`
                + (certificateNumber
                    ? ` ใบรับรอง GACP เลขที่ ${certificateNumber}.`
                    : ` ${nextStepTH}.`),
            smsTH:
                `GACP: ตรวจประเมินคำขอ ${applicationNumber} ผ่านแล้ว`
                + (certificateNumber ? ` ใบรับรอง ${certificateNumber}` : ' รอผลการตัดสินให้การรับรอง'),
        };
    },

    // V3 / V3-A (DI-3 fix, 2026-05-17) — applicant fanout when the
    // auditor's onsite decision is FAIL (→ CAR_PENDING workflow). Mirrors
    // the APPLICANT_AUDIT_PASSED shape so all three onsite outcomes
    // (PASS / FAIL / NEEDS_REVIEW) reach the applicant through the same
    // fanout layer (IN_APP + EMAIL + SMS) instead of degrading to
    // IN_APP-only when the template was missing.
    //
    // Payload contract (matches audit-onsite-service.js submitDecision):
    //   - applicationNumber (string) — for the bell-row title.
    //   - decision (string) — always 'FAIL' on this template; included
    //     so future operator-supplied audits can re-use the bundle.
    //   - summary (string?) — short auditor note, used in HTML + Text.
    //   - criticalFindings (string[]?) — bullet list of failed items.
    //
    // Thai-first copy. The CAR_PENDING UI surface in the applicant
    // portal handles the actual list of correction items; this template
    // only nudges the applicant to log in and act.
    AUDIT_RESULT_CAR: (p = {}) => {
        const applicationNumber = p.applicationNumber || '-';
        const summary = (typeof p.summary === 'string' && p.summary.trim()) ? p.summary.trim() : '';
        const criticalFindings = Array.isArray(p.criticalFindings)
            ? p.criticalFindings.filter((c) => typeof c === 'string' && c.trim().length > 0)
            : [];
        const findingsHtml = criticalFindings.length
            ? `<ul>${criticalFindings.map((c) => `<li>${_escHtml(c)}</li>`).join('')}</ul>`
            : '';
        const findingsText = criticalFindings.length
            ? ` รายการที่ต้องแก้ไข: ${criticalFindings.join('; ')}.`
            : '';
        return {
            subjectTH: `การตรวจประเมิน GACP พบข้อแก้ไข คำขอ ${applicationNumber}`,
            subjectEN: `Audit requires corrective action — application ${applicationNumber}`,
            bodyTHHtml:
                `<p>เรียนผู้สมัคร,</p>`
                + `<p>การตรวจประเมินฟาร์มของท่านสำหรับคำขอ `
                + `<strong>${_escHtml(applicationNumber)}</strong> พบข้อที่ต้องแก้ไข `
                + `(Corrective Action Required).</p>`
                + (summary ? `<p>หมายเหตุจากผู้ตรวจ: <em>${_escHtml(summary)}</em></p>` : '')
                + (findingsHtml ? `<p><strong>รายการที่ต้องแก้ไข:</strong></p>${findingsHtml}` : '')
                + `<p>กรุณาเข้าสู่ระบบเพื่อดำเนินการตามรายการในระบบ `
                + `เมื่อแก้ไขครบถ้วน ผู้ตรวจจะนัดหมายตรวจซ้ำตามขั้นตอน.</p>`
                + `<p>ทีม GACP</p>`,
            bodyTHText:
                `การตรวจประเมิน GACP คำขอ ${applicationNumber} `
                + `พบข้อที่ต้องแก้ไข กรุณาดำเนินการตามรายการในระบบ.`
                + (summary ? ` หมายเหตุ: ${summary}.` : '')
                + findingsText,
            smsTH:
                `GACP: คำขอ ${applicationNumber} ต้องแก้ไขตามผลตรวจ `
                + `กรุณาเข้าสู่ระบบเพื่อดำเนินการ`,
        };
    },

    // V3 / V3-A (DI-3 fix, 2026-05-17) — applicant fanout when the
    // auditor's onsite decision is NEEDS_REVIEW (audit stays in
    // AUDIT_CONFIRMED, flagged needsHeadAuditorReview = true). The
    // applicant gets a heads-up that the result is pending head-auditor
    // review; no immediate action is required from them.
    AUDIT_RESULT_NEEDS_REVIEW: (p = {}) => {
        const applicationNumber = p.applicationNumber || '-';
        const summary = (typeof p.summary === 'string' && p.summary.trim()) ? p.summary.trim() : '';
        return {
            subjectTH: `ผลการตรวจประเมิน GACP อยู่ระหว่างพิจารณา คำขอ ${applicationNumber}`,
            subjectEN: `Audit result under review — application ${applicationNumber}`,
            bodyTHHtml:
                `<p>เรียนผู้สมัคร,</p>`
                + `<p>การตรวจประเมินฟาร์มของท่านสำหรับคำขอ `
                + `<strong>${_escHtml(applicationNumber)}</strong> เสร็จสิ้นแล้ว `
                + `และอยู่ระหว่างการพิจารณาเพิ่มเติมโดยหัวหน้าผู้ตรวจ.</p>`
                + (summary ? `<p>หมายเหตุจากผู้ตรวจ: <em>${_escHtml(summary)}</em></p>` : '')
                + `<p>ในขณะนี้ยังไม่ต้องดำเนินการใด ๆ ระบบจะแจ้งผลให้ท่านทราบ `
                + `เมื่อการพิจารณาเสร็จสิ้น.</p>`
                + `<p>ทีม GACP</p>`,
            bodyTHText:
                `ผลการตรวจประเมิน GACP คำขอ ${applicationNumber} `
                + `อยู่ระหว่างการพิจารณาเพิ่มเติม ยังไม่ต้องดำเนินการ.`
                + (summary ? ` หมายเหตุ: ${summary}.` : ''),
            smsTH:
                `GACP: ผลตรวจคำขอ ${applicationNumber} อยู่ระหว่างพิจารณา `
                + `จะแจ้งให้ทราบเมื่อพิจารณาเสร็จ`,
        };
    },

    AUDIT_SCHEDULED: (p = {}) => {
        const applicationNumber = p.applicationNumber || '-';
        const dateBE = p.date ? formatBE(p.date) : '';
        const timeBE = p.date ? formatBETime(p.date) : (p.time || '');
        const auditorName = p.auditorName || 'ผู้ตรวจที่ได้รับมอบหมาย';
        return {
            subjectTH: `นัดหมายตรวจฟาร์ม คำขอ ${applicationNumber}`,
            subjectEN: `Audit scheduled — application ${applicationNumber}`,
            bodyTHHtml:
                `<p>เรียนผู้สมัคร,</p>`
                + `<p>การตรวจฟาร์มของท่านสำหรับคำขอ <strong>${_escHtml(applicationNumber)}</strong> ถูกนัด.</p>`
                + `<p>วันที่: ${_escHtml(dateBE)}</p>`
                + `<p>เวลา: ${_escHtml(timeBE)} น.</p>`
                + `<p>ผู้ตรวจ: ${_escHtml(auditorName)}</p>`,
            bodyTHText:
                `การตรวจฟาร์มของท่านถูกนัดวันที่ ${dateBE} เวลา ${timeBE} น. ผู้ตรวจ: ${auditorName}.`,
            smsTH:
                `ตรวจฟาร์ม ${applicationNumber}: ${dateBE} ${timeBE} น. ผู้ตรวจ ${auditorName}`,
        };
    },
});

/**
 * Resolve a NotifyType to its template bundle. Returns null when the type
 * has no email/SMS template registered — caller can decide to fall back to
 * IN_APP-only.
 */
function getTemplateForType(type, payload = {}) {
    const builder = TEMPLATES[type];
    if (!builder) {return null;}
    return builder(payload);
}

// ── User resolution ────────────────────────────────────────────────────────

function resolvePrisma() {
    return prismaModule && prismaModule.prisma ? prismaModule.prisma : null;
}

/**
 * Load minimum user contact + prefs for fanout. Returns null when the
 * user has been soft-deleted or doesn't exist.
 *
 * Channel opt-out: User.notificationSettings.channels[type].{email,sms,inApp}
 * defaults to true for each (default-allow per Phase 7 contract — see
 * notification-preferences-service.js).
 */
async function _loadUserContact(userId) {
    const prisma = resolvePrisma();
    if (!prisma) {return null;}
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            phoneNumber: true,
            firstName: true,
            lastName: true,
            notificationSettings: true,
            organizationId: true,
            // C2-class: User has no `smsOptIn` column → this select threw
            // PrismaClientValidationError, and because every send() caller wraps
            // fanout in best-effort try/catch it was SILENTLY swallowed — the
            // entire fanout notification feature was dead. SMS opt-in is derived
            // from the notificationSettings JSON (see _isChannelAllowed).
        },
    });
    return user || null;
}

function _isChannelAllowed(user, type, channel) {
    const settings = user?.notificationSettings;
    if (!settings || typeof settings !== 'object') {return true;}
    const channels = settings.channels && typeof settings.channels === 'object'
        ? settings.channels : {};
    const entry = channels[type];
    if (!entry) {return true;} // default-allow
    // IN_APP is the only channel this dispatcher still sends (Task 2) —
    // kept parametrised on `channel` for signature stability rather than
    // hardcoding 'inApp'.
    const key = channel === CHANNELS.IN_APP ? 'inApp' : channel;
    return entry[key] !== false;
}

// Map a CHANNELS.* constant to the key it occupies in the fanout result object.
const _CHANNEL_RESULT_KEY = Object.freeze({
    [CHANNELS.IN_APP]: 'inApp',
});

/**
 * A channel outcome is RETRIABLE only when it is a transient dispatch failure:
 * `{ ok:false, error }` produced by a dispatcher's catch block (SMTP/SMS/in-app
 * threw). Delivered (`ok:true`), permanent skips (`skipped: OPT_OUT|NO_EMAIL|
 * NO_PHONE|SMS_OPT_OUT|NO_TEMPLATE|NO_USER`) and `NOT_REQUESTED` all carry a
 * `skipped` marker and are NOT retriable — re-attempting them cannot improve
 * the result and (for the delivered case) would double-send. This is the
 * predicate that lets the dedupe slot retry a flaky channel within the window
 * instead of caching the failure for the full 60 minutes.
 */
function _isOutcomeRetriable(outcome) {
    return Boolean(outcome) && outcome.ok === false && !outcome.skipped;
}

/**
 * Of the channels requested on THIS call, which still hold a transient-failure
 * outcome in the cached dedupe result (and therefore warrant a re-dispatch).
 */
function _unsettledRequestedChannels(cached, wantedChannels) {
    const out = new Set();
    for (const ch of wantedChannels) {
        const key = _CHANNEL_RESULT_KEY[ch];
        if (key && _isOutcomeRetriable(cached?.[key])) { out.add(ch); }
    }
    return out;
}

/**
 * Normalise a Thai phone number to E.164.
 * Accepts 0XXXXXXXXX, +66XXXXXXXXX, 66XXXXXXXXX. Returns null on garbage
 * input — the caller skips SMS dispatch when null.
 */
function _normalizePhone(raw) {
    if (!raw || typeof raw !== 'string') {return null;}
    const digits = raw.replace(/[^\d+]/g, '');
    if (digits.startsWith('+66')) {return digits;}
    if (digits.startsWith('66') && digits.length >= 11) {return `+${digits}`;}
    if (digits.startsWith('0') && digits.length === 10) {return `+66${digits.slice(1)}`;}
    if (digits.length === 9) {return `+66${digits}`;}
    return null;
}

// ── Channel dispatchers ────────────────────────────────────────────────────

async function _dispatchInApp({ user, type, payload, template }) {
    // Use the existing notification-service so the bell-icon row contract
    // is identical to the rest of the system.
    const titleTH = template?.subjectTH || 'การแจ้งเตือนใหม่';
    const messageTH = template?.bodyTHText || 'คุณมีการแจ้งเตือนใหม่';
    try {
        const row = await notificationService.createNotification({
            userId: user.id,
            type,
            title: titleTH,
            message: messageTH,
            data: { ...payload, timestamp: new Date().toISOString() },
            priority: payload?.priority || 'NORMAL',
            actionUrl: payload?.actionUrl || null,
        });
        return { ok: true, id: row?.id || null };
    } catch (err) {
        logger.warn(`[fanout] IN_APP dispatch failed for ${user.id}/${type}: ${err?.message}`);
        return { ok: false, error: err?.message };
    }
}

/**
 * Dispatch a specific set of channels for an already-resolved user/template,
 * returning a partial result object keyed { inApp?, email?, sms? } for ONLY
 * the channels that were run. Shared by the first-pass fan-out and the
 * dedupe-slot partial-retry path so both honour per-user opt-outs identically.
 *
 * EMAIL/SMS are retired dispatch legs (Task 2, external-services cleanup):
 * when a caller's `channels` array still names them (some callers pass
 * ['IN_APP','EMAIL','SMS'] explicitly, e.g. refund-service.js;
 * others omit `channels` entirely — e.g.
 * audit-onsite-service.js, audit-scheduling-service.js,
 * renewal-reminder-cron.js — and never reach this branch, since the
 * ALL_CHANNELS default is IN_APP-only), they come back marked
 * `{ ok:false, skipped:'CHANNEL_RETIRED' }` rather than being dispatched or
 * silently dropped, so a caller reading `result.email`/`result.sms` (none
 * do today — verified by repo-wide grep) still sees a well-formed outcome.
 */
async function _runChannels(channelsToRun, { user, type, payload, template }) {
    const out = {};
    if (channelsToRun.has(CHANNELS.IN_APP)) {
        out.inApp = _isChannelAllowed(user, type, CHANNELS.IN_APP)
            ? await _dispatchInApp({ user, type, payload, template })
            : { ok: false, skipped: 'OPT_OUT' };
    }
    for (const retired of RETIRED_CHANNELS) {
        if (channelsToRun.has(retired)) {
            out[retired === 'EMAIL' ? 'email' : 'sms'] = { ok: false, skipped: 'CHANNEL_RETIRED' };
        }
    }
    return out;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Fan out a notification across the requested channels with dedupe.
 *
 * @param {object} args
 * @param {string} args.userId   — recipient User.id (NOT canonicalId).
 * @param {string} args.type     — NotifyType key (see TEMPLATES).
 * @param {object} args.payload  — template variables. Should carry
 *                                 applicationId/invoiceId/period when
 *                                 available so dedupe is correct.
 * @param {string[]} [args.channels] — defaults to [IN_APP]. 'EMAIL'/'SMS'
 *                                     are accepted (call-site compatibility)
 *                                     but never dispatched — see EMAIL/SMS
 *                                     shape below.
 * @returns {Promise<{
 *   dedupeKey: string, deduped: boolean,
 *   inApp: { ok, id?, skipped?, error? },
 *   email: { ok: false, skipped: 'CHANNEL_RETIRED'|'NOT_REQUESTED'|'NO_USER' },
 *   sms:   { ok: false, skipped: 'CHANNEL_RETIRED'|'NOT_REQUESTED'|'NO_USER' },
 * }>}
 */
async function send({ userId, type, payload = {}, channels = ALL_CHANNELS } = {}) {
    if (!userId || !type) {
        const err = new Error('[fanout] userId + type are required');
        err.code = 'VALIDATION_ERROR';
        throw err;
    }
    const wantedChannels = new Set(channels);

    const dedupeKey = _makeDedupeKey({ userId, type, payload });

    // Step 1: read-side dedupe — if a previous call already wrote a final
    // result to the slot, return it (within the 60-min window). The
    // sentinel string is intentionally NOT treated as a hit here so that
    // a concurrent in-flight call doesn't appear as a final dispatch.
    const existing = await _getDedupeResult(dedupeKey);
    if (existing && existing !== DEDUPE_INFLIGHT_SENTINEL) {
        // Partial-retry: a prior attempt may have left one or more requested
        // channels in a TRANSIENT-failure state (e.g. the SMTP host was down
        // for a few seconds). Without this, the failed channel stayed un-sent
        // for the full 60-min window because the cached failure short-circuited
        // every retry. Re-attempt ONLY those channels and merge — delivered and
        // permanently-skipped channels are never re-sent, so there is no
        // duplicate delivery.
        const retryChannels = _unsettledRequestedChannels(existing, wantedChannels);
        if (retryChannels.size === 0) {
            logger.info('[fanout] DEDUPED', { userId, type, dedupeKey });
            return { ...existing, deduped: true };
        }
        // NOTE: this retry runs on the read path without re-claiming the
        // in-flight sentinel, so two simultaneous retries of the same
        // previously-failed notification could each re-attempt the failed
        // channel. That window is small and strictly better than the silent
        // 60-min drop it replaces — delivery is at-least-once for the flaky
        // channel, exactly-once for the channels that already succeeded.
        logger.info('[fanout] DEDUPE partial-retry of unsettled channels', {
            userId, type, dedupeKey, retry: Array.from(retryChannels),
        });
        const retryUser = await _loadUserContact(userId);
        if (!retryUser) {
            return { ...existing, deduped: true };
        }
        const retryTemplate = getTemplateForType(type, payload);
        const merged = { ...existing, deduped: false };
        Object.assign(
            merged,
            await _runChannels(retryChannels, { user: retryUser, type, payload, template: retryTemplate }),
        );
        await _writeDedupeResult(dedupeKey, merged);
        return merged;
    }

    // Step 2: atomically claim the slot with an IN-FLIGHT sentinel
    // BEFORE doing any dispatch work. The first caller to write wins;
    // any concurrent caller that loses the NX race waits for the
    // winner's final result and returns it without dispatching.
    const claimed = await _claimDedupeSlot(dedupeKey, DEDUPE_INFLIGHT_SENTINEL);
    if (!claimed) {
        const finalResult = await _waitForResult(dedupeKey);
        if (finalResult && finalResult !== DEDUPE_INFLIGHT_SENTINEL) {
            logger.info('[fanout] DEDUPED (lost NX race)', { userId, type, dedupeKey });
            return { ...finalResult, deduped: true };
        }
        // Winner timed out or crashed — fall through and dispatch
        // defensively so the recipient still gets the notification.
        logger.warn(`[fanout] dedupe wait timed out for ${dedupeKey} — proceeding with dispatch`);
    }

    const user = await _loadUserContact(userId);
    if (!user) {
        logger.warn(`[fanout] user ${userId} not found; skipping`);
        const empty = {
            dedupeKey, deduped: false,
            inApp: { ok: false, skipped: 'NO_USER' },
            email: { ok: false, skipped: 'NO_USER' },
            sms: { ok: false, skipped: 'NO_USER' },
        };
        await _writeDedupeResult(dedupeKey, empty);
        return empty;
    }

    const template = getTemplateForType(type, payload);
    if (!template) {
        logger.warn(`[fanout] no template for type=${type} — IN_APP only via notification-service`);
    }

    const result = {
        dedupeKey,
        deduped: false,
        inApp: { ok: false, skipped: 'NOT_REQUESTED' },
        email: { ok: false, skipped: 'NOT_REQUESTED' },
        sms: { ok: false, skipped: 'NOT_REQUESTED' },
    };

    // Dispatch every requested channel (non-requested channels keep their
    // NOT_REQUESTED marker). Shared with the partial-retry path above.
    Object.assign(result, await _runChannels(wantedChannels, { user, type, payload, template }));

    // Step 3: overwrite the in-flight sentinel with the final result so
    // any waiting losers (and any subsequent send() within the window)
    // can read the canonical dispatch result.
    await _writeDedupeResult(dedupeKey, result);
    return result;
}

/**
 * Test-only helper. Clears the in-process dedupe shim AND invalidates the
 * Redis-namespaced dedupe keys so each test starts with a clean slate.
 * Not exposed on the public surface name.
 *
 * @private
 */
async function _clearDedupeForTests() {
    _fallbackDedupeStore.clear();
    _warnedRedisUnavailable = false;
    if (_redisAvailable() && typeof redisService.invalidatePattern === 'function') {
        try {
            await redisService.invalidatePattern(`${DEDUPE_KEY_PREFIX}*`);
        } catch (_err) {
            // best-effort; tests using a strict mock can override behaviour
        }
    }
}

module.exports = {
    CHANNELS,
    ALL_CHANNELS,
    DEDUPE_WINDOW_MS,
    DEDUPE_TTL_SECONDS,
    DEDUPE_KEY_PREFIX,
    send,
    getTemplateForType,
    _internals: {
        _makeDedupeKey,
        _makeRedisKey,
        _loadUserContact,
        _isChannelAllowed,
        _normalizePhone,
        _pruneFallback,
        _clearDedupeForTests,
        _getDedupeResult,
        _claimDedupeSlot,
        _writeDedupeResult,
        _waitForResult,
        _isOutcomeRetriable,
        _unsettledRequestedChannels,
        _runChannels,
        DEDUPE_INFLIGHT_SENTINEL,
        formatBE,
        formatBETime,
        formatTHB,
        TEMPLATES,
    },
};
