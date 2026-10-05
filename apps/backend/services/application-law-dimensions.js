'use strict';

/**
 * WHICH LAW JUDGES THIS FILING — the door that accepts the applicant's answer.
 *
 * `shared/form-data-ownership.js` marks `requestType`, `certScope` and `replacementOf`
 * server-owned, and its comment names the door that was missing: "the wizard asks the
 * question (T5); the door that accepts the answer is what writes it, after checking it".
 * Until this file existed, nothing did. Step 1 of the wizard asked ประเภทคำขอ and
 * ขอบเขตการรับรอง, the answers stayed in the browser, and every filing was judged
 * NEW / PLANTING — a ต่ออายุ judged as a first application, and a การแปรรูป filing never
 * asked for the ภ.ท. 11 licence that only PROCESSING carries.
 *
 * The two dimensions are NOT the same kind of claim, and this file treats them differently
 * on purpose:
 *
 *   certScope   Measured against the seeded register (scripts/seed-herb-requirement-rules.js:147):
 *               exactly ONE rule keys off certScope — LICENCE_PT11 (cannabis only), which requires
 *               PROCESSING — and NO rule requires PLANTING. PLANTING is also what the lens
 *               falls back to. So honouring the applicant's answer can only ADD a paper to
 *               their own list; it can never take one away. It needs no external proof, and
 *               demanding one would just mean refusing to hear a stricter answer.
 *
 *   requestType RENEWAL and REPLACEMENT are judged by two rows instead of the whole
 *               ส่วนที่ ๓ set. Honouring that answer REMOVES requirements, so it is granted
 *               only against a certificate this platform issued, that is still live, and that
 *               belongs to the person asking. Same three checks renewal-service already makes
 *               (renewal-service.js:289-311) — owner, ACTIVE, not expired.
 *
 * NOTHING HERE THROWS. The wizard autosaves every few seconds, so a half-typed certificate
 * number must not 422 the save and lose the applicant's work. An unproven claim resolves to
 * the STRICTEST reading instead — NEW, which asks for the longer document list — and returns
 * a Thai notice the surface can show. Failing closed costs the applicant a few extra rows on
 * a checklist; failing open would let them pick the law that judges them.
 */

// dimension ของทะเบียนกฎพูดเป็น slug ของ wizard ส่วนใบรับรองเก็บ cropType เป็นชื่อไทยที่
// พิมพ์บนกระดาษ ("กัญชา") — ไม่มีใครแปลกลับได้อย่างปลอดภัย เพราะชื่อบนกระดาษไม่ใช่คำในทะเบียน
// จึงไม่แปลชื่อ แต่ไปอ่าน "คำขอที่ออกใบนั้น" ซึ่งเก็บ plantId เป็น slug อยู่แล้ว — เป็นการ
// สืบสายจากของจริง ไม่ใช่การเดาจากตัวอักษร
const REQUEST_TYPES = Object.freeze(['NEW', 'RENEWAL', 'REPLACEMENT']);
const CERT_SCOPES = Object.freeze(['PLANTING', 'PROCESSING']);

/** Every key this resolver may write. Pinned against the server-owned list by its suite. */
const LAW_DIMENSION_KEYS = Object.freeze([
    'requestType',
    'certScope',
    'renewalOf',
    'renewalOfCertificateNumber',
    'renewalOfExpiryDate',
    'replacementOf',
]);

const CERT_ACTIVE = 'active';

/** The capability a renewal claim needs on the certificate's holder (a renewal is a submission). */
const RENEWAL_CAPABILITY = 'SUBMIT_APPLICATION';

// Lazy: holder-access and the permission engine load prisma-database, and this file is
// required by suites that only exercise the pure resolver.
const { toCanonicalCertificateNumber } = require('./certificate-number-display');
const _holderAccess = () => require('./holder-access');
const _permissionEngine = () => require('./entity-effective-permissions-service');

/**
 * The strictest reading, used whenever a RENEWAL or REPLACEMENT claim cannot be proved.
 * It also CLEARS the linkage keys: a filing that was a verified renewal yesterday and names
 * a revoked certificate today must stop being judged as a renewal, not keep yesterday's law.
 */
const AS_NEW = Object.freeze({
    requestType: 'NEW',
    renewalOf: null,
    renewalOfCertificateNumber: null,
    renewalOfExpiryDate: null,
    replacementOf: null,
});

function notice(code, messageTh) {
    return { code, messageTh };
}

function oneOf(value, allowed) {
    const word = String(value || '').trim().toUpperCase();
    return allowed.includes(word) ? word : null;
}

/**
 * @param {object}   args
 * @param {object}   args.prisma        client (only `certificate.findFirst` is used)
 * @param {string}   args.actorUserId   the caller — must hold SUBMIT_APPLICATION on the certificate's holder
 * @param {object}   args.claimed       what the applicant's payload says (untrusted)
 * @param {object}   [args.stored]      the filing's current formData (unused except for shape)
 * @param {?string}  [args.filingEntityId] the holder the filing is made for (Application.entityId).
 *                                      A RENEWAL is granted only when the previous certificate's
 *                                      holder is this entity AND the caller holds
 *                                      SUBMIT_APPLICATION on it (operator ruling 2026-10-03).
 * @param {object}   [args.holderScope] the door's holder scope; none from other callers
 * @returns {Promise<{dimensions: object, notice: ?{code: string, messageTh: string}}>}
 *          `dimensions` holds ONLY the keys that should change. An empty object means the
 *          applicant said nothing about the law and the filing keeps what it had.
 */
async function resolveLawDimensions({
    prisma, actorUserId, claimed, stored, filingEntityId = null, holderScope = null,
} = {}) {
    const said = claimed && typeof claimed === 'object' ? claimed : {};
    const dimensions = {};

    // ── certScope: heard as given, because it can only ask for more ──────────
    const scope = oneOf(said.certScope, CERT_SCOPES);
    if (scope) {
        dimensions.certScope = scope;
    }

    // ── requestType: silence changes nothing ─────────────────────────────────
    const wanted = oneOf(said.requestType, REQUEST_TYPES);
    if (!wanted) {
        return { dimensions, notice: null };
    }

    if (wanted === 'NEW') {
        return { dimensions: { ...dimensions, ...AS_NEW }, notice: null };
    }

    // The applicant copies this from the paper (GACP-DTAM-…); the register stores GACP-TH-….
    const number = toCanonicalCertificateNumber(String(said.previousCertificateNumber || '').trim());
    if (!number) {
        return {
            dimensions: { ...dimensions, ...AS_NEW },
            notice: notice(
                'PREVIOUS_CERTIFICATE_REQUIRED',
                'กรุณากรอกเลขที่ใบรับรองเดิม ระบบจึงจะพิจารณาคำขอนี้เป็นการต่ออายุหรือขอใบแทนได้ '
                + 'ระหว่างนี้ระบบจะขอเอกสารชุดเต็มแบบคำขอใหม่ไว้ก่อน',
            ),
        };
    }

    let cert = null;
    try {
        // By NUMBER, never by id: the number is what is printed on the applicant's own
        // certificate, and an internal id in an applicant payload is a handle for guessing
        // at other people's rows.
        cert = await prisma.certificate.findFirst({
            where: {
                certificateNumber: number,
                isDeleted: false,
                // A health caller passes its holder scope: a certificate outside it is
                // not found here (spec 2026-09-30 §3.1).
                ..._holderAccess().holderReadWhereIfScoped(holderScope, 'Certificate'),
            },
            select: {
                id: true, certificateNumber: true, status: true, expiryDate: true,
                // พืชที่ใบเดิมรับรอง — อ่านจากคำขอที่ออกใบนั้น (plantId เป็น slug เดียวกับ
                // ที่ทะเบียนกฎใช้) ไม่ใช่จาก cropType ที่เป็นชื่อไทยบนกระดาษ
                // entityId คือผู้ถือใบเดิม ใช้ตัดสินว่าคำขอนี้ต่ออายุในนามผู้ถือเดียวกันหรือไม่
                application: { select: { formData: true, entityId: true } },
            },
        });
    } catch (error) {
        // A database that cannot answer is not a licence to grant the claim. Neither is it
        // a reason to lose the draft.
        return {
            dimensions: { ...dimensions, ...AS_NEW },
            notice: notice(
                'PREVIOUS_CERTIFICATE_UNVERIFIABLE',
                'ระบบตรวจสอบใบรับรองเดิมไม่ได้ในขณะนี้ ข้อมูลที่กรอกไว้ถูกบันทึกแล้ว '
                + 'กรุณาลองใหม่อีกครั้งก่อนกดยื่นคำขอ',
            ),
        };
    }

    if (!cert) {
        return {
            dimensions: { ...dimensions, ...AS_NEW },
            notice: notice(
                'PREVIOUS_CERTIFICATE_NOT_FOUND',
                'ไม่พบใบรับรองเลขที่นี้ในระบบ กรุณาตรวจสอบเลขที่บนใบรับรองเดิมอีกครั้ง '
                + 'ใบรับรองที่ออกโดยหน่วยงานอื่นใช้ต่ออายุที่นี่ไม่ได้',
            ),
        };
    }

    // Operator ruling 2026-10-03: who filed the previous certificate does not matter;
    // the holder rule and SUBMIT_APPLICATION below decide (no filer match).

    if (String(cert.status || '').toLowerCase() !== CERT_ACTIVE) {
        return {
            dimensions: { ...dimensions, ...AS_NEW },
            notice: notice(
                'PREVIOUS_CERTIFICATE_NOT_ACTIVE',
                'ใบรับรองใบนี้ไม่ได้อยู่ในสถานะที่ยังมีผล จึงต่ออายุหรือขอใบแทนไม่ได้ '
                + 'กรุณายื่นเป็นคำขอใหม่',
            ),
        };
    }

    if (cert.expiryDate && new Date(cert.expiryDate).getTime() <= Date.now()) {
        return {
            dimensions: { ...dimensions, ...AS_NEW },
            notice: notice(
                'PREVIOUS_CERTIFICATE_EXPIRED',
                'ใบรับรองใบนี้หมดอายุแล้ว การขอใบแทนใช้กับใบที่ยังไม่หมดอายุเท่านั้น '
                + 'กรุณายื่นเป็นคำขอใหม่',
            ),
        };
    }

    // ── ต่ออายุ/ใบแทน = การยื่นคำขอในนามผู้ถือใบเดิม (มติ operator 2026-10-03) ──────
    // (a) ใบเดิมต้องเป็นของผู้ถือเดียวกับคำขอนี้: ใบของบริษัทต่ออายุหรือขอใบแทนในนามบุคคลไม่ได้
    // (b) ผู้ยื่นต้องมีสิทธิ์ SUBMIT_APPLICATION บนผู้ถือนั้น
    // ใช้กับทั้งสองคำอ้าง เพราะทั้งสองลดเอกสารที่ต้องยื่น (ต่ออายุยังข้ามด่านตรวจเอกสาร)
    // ไม่ผ่านข้อใด = อ่านเป็นคำขอใหม่ (ชุดเอกสารเต็ม) พร้อมข้อความบอกเหตุ ร่างยังบันทึกตามปกติ
    // ประตูยื่นตรวจ (a) ซ้ำก่อนเปลี่ยนสถานะ เพราะสมาชิกภาพเปลี่ยนได้ระหว่างร่างกับยื่น
    if (wanted === 'RENEWAL' || wanted === 'REPLACEMENT') {
        const certHolder = cert.application?.entityId || null;
        if (!certHolder || !filingEntityId || certHolder !== filingEntityId) {
            return {
                dimensions: { ...dimensions, ...AS_NEW },
                notice: notice(
                    'PREVIOUS_CERTIFICATE_OTHER_HOLDER',
                    'ใบรับรองใบนี้ออกในนามผู้ถือรายอื่น จึงต่ออายุหรือขอใบแทนในนามที่กำลังยื่นอยู่ไม่ได้ '
                    + 'กรุณาสลับไปยื่นในนามผู้ถือใบรับรองใบนั้น',
                ),
            };
        }
        try {
            await _permissionEngine().assertEntityActionPermission({
                userId: actorUserId, entityId: certHolder, permission: RENEWAL_CAPABILITY, prisma,
            });
        } catch (_denied) {
            // The engine fails closed on a lookup fault as well as on a denial; both mean
            // "not proven allowed", and the stricter reading is the safe one.
            return {
                dimensions: { ...dimensions, ...AS_NEW },
                notice: notice(
                    'PREVIOUS_CERTIFICATE_NO_SUBMIT_RIGHT',
                    'บัญชีของคุณไม่มีสิทธิ์ยื่นคำขอในนามผู้ถือใบรับรองใบนี้ จึงต่ออายุหรือขอใบแทนไม่ได้ '
                    + 'ขอให้เจ้าของมอบสิทธิ์ยื่นคำขอให้คุณก่อน แล้วลองอีกครั้ง',
                ),
            };
        }
    }

    const expiry = cert.expiryDate ? new Date(cert.expiryDate).toISOString() : null;

    // ── พืช: มาจากใบรับรองที่คำขอนี้ต่อ ไม่ใช่จากคำถามใหม่ ────────────────────────
    // หน้าจอขั้น 1 ไม่ถามพืชกับคำขอต่ออายุ/ใบแทน โดยตั้งใจ (step1-request-type-config.ts:87-94
    // — "asking again invites a filing whose scope contradicts the certificate it succeeds")
    // แต่ทะเบียนกฎผูกกติกาเอกสารทุกข้อไว้กับพืช และเครื่องปฏิเสธคำขอที่ไม่บอกพืชด้วย
    // PLANT_NOT_DECLARED ⇒ ถ้าไม่ยกค่าจากใบเดิมมาให้ คำขอต่ออายุจะเดินต่อไม่ได้เลย และ
    // เกษตรกรไม่มีช่องไหนให้แก้ (เจอตอนเดินหน้าจอจริง 2026-09-07)
    //
    // คำตอบที่คำขอประกาศเองยังชนะเสมอ: ใบเดิมเติมเฉพาะช่องที่ยังว่าง เหมือนกฎ fill-only-blank
    // ที่ใช้กับที่ตั้งฟาร์มตอนออกใบรับรอง
    const previousFormData = cert.application && typeof cert.application.formData === 'object'
        ? cert.application.formData
        : {};
    const inheritedPlantId = typeof previousFormData.plantId === 'string'
        && previousFormData.plantId.trim() !== ''
        ? previousFormData.plantId.trim()
        : null;
    // เขียนเป็น `plantId` เพราะนั่นคือคีย์ที่เลนส์กติกาอ่าน (formData.plantId) และเพราะ
    // dimensions ถูก spread ทับทีหลังทุกอย่าง จึงเติมเฉพาะตอนที่คำขอนี้ยังไม่มีคำตอบของตัวเอง
    // ทั้งในสิ่งที่เพิ่งส่งมาและในร่างที่บันทึกไว้ — คำตอบของผู้ยื่นต้องไม่ถูกทับด้วยของใบเก่า
    const alreadyAnswered = String(said.plantId || '').trim() !== ''
        || String((stored && typeof stored === 'object' ? stored.plantId : '') || '').trim() !== '';
    const plantFromCertificate = (!alreadyAnswered && inheritedPlantId)
        ? { plantId: inheritedPlantId }
        : {};

    if (wanted === 'REPLACEMENT') {
        return {
            dimensions: {
                ...dimensions,
                ...plantFromCertificate,
                requestType: 'REPLACEMENT',
                replacementOf: cert.id,
                renewalOf: null,
                renewalOfCertificateNumber: cert.certificateNumber,
                renewalOfExpiryDate: expiry,
            },
            notice: null,
        };
    }

    return {
        dimensions: {
            ...dimensions,
            ...plantFromCertificate,
            requestType: 'RENEWAL',
            renewalOf: cert.id,
            renewalOfCertificateNumber: cert.certificateNumber,
            renewalOfExpiryDate: expiry,
            replacementOf: null,
        },
        notice: null,
    };
}

module.exports = {
    resolveLawDimensions,
    LAW_DIMENSION_KEYS,
    REQUEST_TYPES,
    CERT_SCOPES,
};
