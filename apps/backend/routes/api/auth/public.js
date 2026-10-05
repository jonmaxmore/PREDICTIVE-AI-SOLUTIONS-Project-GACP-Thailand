/**
 * Public Certificate Verification Routes (V2)
 * No authentication required - for public QR code scanning
 * Uses Prisma for data access
 */

const express = require('express');
const router = express.Router();
// Public verify routes go through certificate-service so that lookup logic
// (no isDeleted filter, revocation visibility) stays in one place. Route-
// level Prisma access removed — see docs/tech-debt/prisma-bypass-routes.md.
const certificateService = require('../../../services/certificate-service');
// F-G4-57: the one derivation of the public "why is this not valid" answer —
// the machine code and the English sentence come out of the same call, so the
// two can never disagree on the wire.
const {
    publicReasonFor,
    isSupersededByRenewal,
    PUBLIC_VERIFY_LOOKUP_FAILURES,
} = require('./public-verify-reason');
const logger = require('../../../shared/logger');
const { DEFAULT_TIME_ZONE } = require('../../../utils/working-days');

// Per-IP limit on every public lookup-by-number door lives in one place:
// middleware/public-verify-limiter. Numbers are sequential (TH-GACP {n}/{BE}),
// so the protection against walking the register is that limiter plus the
// minimal response below (no farm facts unless active, masked applicant).
const { publicVerifyLimiter } = require('../../../middleware/public-verify-limiter');

// PR-1.5: minimum personal-information disclosure on public verify.
// We mask the applicant's last name to a single initial. This still
// lets a verifier confirm "is this Mr. Somchai's farm?" while a
// scraper cannot harvest a registry of full names. Farm name and
// province remain visible — they are the unit of certification and
// are required for the verification page to be useful.
function maskApplicantName(rawName) {
    if (!rawName) {return null;}
    const trimmed = String(rawName).trim();
    if (!trimmed) {return null;}
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {return parts[0];}
    const last = parts[parts.length - 1];
    const masked = last.charAt(0) + '.';
    return [...parts.slice(0, -1), masked].join(' ');
}

// M1 (plan D2): the certificate is held by the FARM/entity, not by the person
// who filled the form. `holderDisplayName` + `holderType` are written at
// issuance (certification.prisma:34-35); rows issued before the backfill carry
// neither, so they are read as the legacy person name.
//
// Masking rule: a juristic / community-enterprise name is a *business* name in
// a public registry — masking it makes the verify page useless without
// protecting anyone. A person-shaped holder (INDIVIDUAL / LEGACY_PERSON /
// unknown) keeps going through the PR-1.5 anti-scraping mask above.
const UNMASKED_HOLDER_TYPES = new Set(['JURISTIC', 'COMMUNITY_ENTERPRISE']);

function holderNameForDisplay(cert) {
    if (!cert) {return null;}
    const name = cert.holderDisplayName || cert.applicantName;
    const type = cert.holderDisplayName ? cert.holderType : 'LEGACY_PERSON';
    if (UNMASKED_HOLDER_TYPES.has(type)) {return name || null;}
    return maskApplicantName(name);
}

// The ONE derivation of a live certificate's public state, shared by every
// verify door. A certificate the main door reports as not active (status not
// 'active', or past expiryDate) has its facts withheld on every door, so the
// archived-revision door can never be the more generous one.
//   isExpired — expiryDate is set and already passed
//   isActive  — status 'active' and not expired
//   status    — the public status word: 'expired' wins over the stored status
function liveCertificateState(certificate) {
    const isExpired = Boolean(certificate.expiryDate && new Date(certificate.expiryDate) < new Date());
    const stored = certificate.status.toLowerCase();
    return {
        isExpired,
        isActive: stored === 'active' && !isExpired,
        status: isExpired ? 'expired' : stored,
    };
}

/**
 * @route GET /verify/:certificateNumber
 * @desc Public certificate verification (JSON)
 * @access Public
 */
router.get('/verify/:certificateNumber', publicVerifyLimiter, async (req, res) => {
    try {
        const { certificateNumber } = req.params;
        const { code } = req.query;

        if (!certificateNumber) {
            return res.status(400).json({
                success: false,
                message: 'Certificate number is required',
            });
        }

        const certificate = await certificateService.findByCertificateNumber(certificateNumber);

        if (!certificate) {
            return res.json({
                success: true,
                verified: false,
                valid: false,
                data: {
                    status: 'invalid',
                    // The commonest answer a citizen ever gets. The English
                    // `reason` is unchanged; the `reasonCode` beside it is what
                    // lets the page say it in Thai instead of handing over an
                    // English sentence.
                    ...PUBLIC_VERIFY_LOOKUP_FAILURES.NOT_FOUND,
                },
            });
        }

        const liveState = liveCertificateState(certificate);
        const { isActive, status: liveStatus } = liveState;
        // F-G4-57: WHY this certificate is not valid, as a machine code next to
        // the English sentence the endpoint has always published.
        const { code: reasonCode, reason } = publicReasonFor(liveState, certificate.status);

        // BE-#4: content-integrity check. Recompute the documentHash from the
        // live row and compare to the stored one — surfaces VALID / TAMPERED /
        // UNSIGNED (legacy certs issued before hashing) to the public verifier.
        const integrity = certificateService.verifyDocumentIntegrity(certificate);

        // H1: the hash recompute alone cannot catch a re-signed forgery; verify
        // the RSA signature over the documentHash too. Both the cert NAME
        // (farmName/applicantName) and the hash are covered by the signature, so
        // surfacing the signature verdict is genuine tamper-evidence.
        const signature = await certificateService.verifyCertificateSignature(certificate);

        // Code verification (optional if provided in QR)
        // Note: Prisma schema might not have verificationCode? 
        // Based on GACPCertificateService, it generates it. 
        // We should check if it exists on the model.
        // Assuming it does for backward compat or we skip it if null.
        if (code && certificate.verificationCode && certificate.verificationCode !== code) {
            return res.json({
                success: true,
                verified: false,
                valid: false,
                data: {
                    status: 'invalid',
                    // A QR whose code does not match the document: same
                    // treatment as not-found — unchanged English, plus the
                    // machine code the Thai page needs.
                    ...PUBLIC_VERIFY_LOOKUP_FAILURES.CODE_MISMATCH,
                },
            });
        }

        // Certificate revision (ฉบับแก้ไขภายใต้เลขเดิม): a certificate past
        // revision 1 says so, with the Thai label of the reason CODE and the
        // list of archived revisions. The admin's free text (reasonText) is
        // never read here. Reported in the not-active branch too: a revised
        // certificate can later expire, and its history does not expire with it.
        const revision = (certificate.revisionNo || 1) > 1
            ? {
                no: certificate.revisionNo,
                revisedAt: certificate.revisedAt ? new Date(certificate.revisedAt).toISOString() : null,
                reasonLabel: certificateService.REVISION_REASON_LABELS_TH[certificate.revisionReason] || null,
                history: await certificateService.listRevisionSummaries(certificate.id),
            }
            : null;

        // F-G4-57: a certificate superseded by a renewal points at the document
        // that replaced it, so a citizen scanning an obsolete QR is sent to the
        // current one instead of being told only "not valid". The NUMBER is the
        // whole of it: the successor's own facts belong to the successor's own
        // verify answer, not to this one.
        const successorCertificateNumber = isSupersededByRenewal(certificate.status)
            ? await certificateService.findSuccessorCertificateNumber(certificate.renewedCertificateId)
            : null;
        const renewal = successorCertificateNumber ? { successorCertificateNumber } : null;

        // Return legacy-compatible structure
        return res.json({
            success: true,
            verified: isActive,
            valid: isActive, // Alias
            data: {
                // The stored number, so a lookup by the printed GACP-DTAM form still
                // answers with the register's own GACP-TH form.
                certificateNumber: certificate.certificateNumber || certificateNumber,
                status: liveStatus,
                // Surface WHY a certificate is not valid so the public QR page
                // can distinguish expired / suspended (ISO 17065 §7.11 —
                // temporary, reversible) / revoked (permanent) / renewed rather
                // than a bare "not valid". A suspended cert is intentionally NOT
                // active (isActive already excludes it), so its farm details
                // stay hidden until reinstated.
                //
                // `reason` keeps its exact English strings for the consumers
                // that already read them; `reasonCode` (F-G4-57) is the machine
                // value a Thai UI translates, so the citizen is not handed an
                // English sentence. Both come from the one derivation above.
                reason,
                reasonCode,
                // BE-#4: tamper-evidence for the verifier. 'TAMPERED' means the
                // stored row no longer matches the hash stamped at issuance.
                integrity: integrity.status,
                // H1: additive crypto-trust verdicts (existing verified/valid/
                // integrity semantics are unchanged).
                //   hashValid      — recomputed documentHash matches the stored one
                //   signatureValid — RSA signature verifies over documentHash;
                //                     NULL (not false) when the cert is unsigned
                //                     so legacy certs are NOT falsely flagged tampered
                //   sealed         — the cert carries a PKI signature at all
                hashValid: integrity.status === 'VALID',
                signatureValid: signature.signed ? signature.valid === true : null,
                sealed: signature.signed === true,
                publicKeyFingerprint: signature.publicKeyFingerprint || null,
                // Certificate revision: null at revision 1, else
                // { no, revisedAt, reasonLabel, history: [{ no, signedAt, supersededAt }] }.
                revision,
                // F-G4-57: { successorCertificateNumber } when this certificate
                // was superseded by a renewal that still exists, else null.
                renewal,
                certificate: isActive ? {
                    farmName: certificate.farmName,
                    // PR-1.5: applicantName is masked (last name → initial)
                    // so a public verifier can still confirm identity but
                    // a scraper cannot build a registry of full names.
                    applicantName: maskApplicantName(certificate.applicantName),
                    // M1: the holder of the certificate (farm entity when the
                    // application was filed by a member). ADDITIVE — the
                    // applicantName field above keeps its old value so existing
                    // consumers of this contract do not break.
                    holderDisplayName: holderNameForDisplay(certificate),
                    // findByCertificateNumber returns the raw Certificate row,
                    // whose schema is flat: province (not location.province),
                    // cropType singular (not cropTypes/plantType), issuedDate
                    // (not issueDate), standardName (not certificationStandards).
                    // The earlier field names resolved to undefined, so the
                    // public QR page showed blank province / crop / issue date.
                    province: certificate.province,
                    cropTypes: certificate.cropType ? [certificate.cropType] : [],
                    issueDate: certificate.issuedDate,
                    expiryDate: certificate.expiryDate,
                    standards: certificate.standardName ? [certificate.standardName] : [],
                    issuingAuthority: 'ระบบรับรองมาตรฐาน GACP สมุนไพร',
                } : null,
                verifiedAt: new Date().toISOString(),
            },
        });
    } catch (error) {
        logger.error('[Public] Verification error:', error);
        return res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการตรวจสอบใบรับรอง',
        });
    }
});

// Certificate revision: the one answer for "no such archived revision" —
// unknown certificate number, a revision index that is not a positive integer,
// or no archived row at that index. One shape so an enumerator learns nothing
// from which of the three it hit. Catalogued as REVISION_NOT_FOUND (404).
function revisionNotFound(res) {
    return res.status(404).json({ success: false, error: 'REVISION_NOT_FOUND' });
}

/**
 * @route GET /verify/:certificateNumber/revisions/:n
 * @desc Public verification of an ARCHIVED revision n of a certificate
 *       (ฉบับแก้ไขภายใต้เลขเดิม): the document as it stood when revision n
 *       was signed, verified from its own archived proof columns and pinned
 *       key. Always `superseded: true` — the live document is /verify/:no.
 * @access Public (same rate limiter as /verify/:certificateNumber)
 */
router.get('/verify/:certificateNumber/revisions/:n', publicVerifyLimiter, async (req, res) => {
    try {
        const certificate = await certificateService.findByCertificateNumber(req.params.certificateNumber);
        // A revision index is a positive integer written in digits only;
        // '1.5', '-1', 'abc' and '0' are refused before any lookup.
        const n = /^\d+$/.test(req.params.n) ? Number.parseInt(req.params.n, 10) : NaN;
        if (!certificate || !Number.isInteger(n) || n < 1) {
            return revisionNotFound(res);
        }
        const out = await certificateService.verifyArchivedRevision(certificate.id, n);
        if (!out.found) {
            return revisionNotFound(res);
        }
        const { revision, integrity, signature } = out;
        // The archived proof columns verify the ARCHIVE; they know nothing of
        // the live row's status (certificateCanonicalJson omits status /
        // isDeleted / revokedAt on purpose, see isCertificateRevoked). So the
        // live state is read here, the same way the main door reads it, and
        // gates what this door may say:
        //   - a revocation marker on the live row → integrity REVOKED, as
        //     verifyDocumentIntegrity answers for the live row itself; a
        //     revoked number never carries a green verdict on any door;
        //   - a live row the main door reports as not active (revoked,
        //     suspended, expired) → snapshot null, as the main door answers
        //     certificate: null. district/subDistrict are the widest location
        //     facts on any public door and are never wider than the main one.
        const live = liveCertificateState(certificate);
        const revoked = certificateService.isCertificateRevoked(certificate);
        const disclose = live.isActive && !revoked;
        const snapshot = revision.snapshot || {};
        return res.json({
            success: true,
            data: {
                certificateNumber: certificate.certificateNumber,
                revisionNo: n,
                superseded: true,
                supersededAt: revision.supersededAt ? new Date(revision.supersededAt).toISOString() : null,
                // The LIVE certificate's public status word, the same value the
                // main door reports as data.status, so the revision page can
                // tell an archived revision of a certificate in force from one
                // whose number is no longer good.
                certificateStatus: revoked ? 'revoked' : live.status,
                integrity: revoked ? 'REVOKED' : integrity.status,
                signatureValid: signature.signed ? signature.valid === true : null,
                // The public facts of the archived document only, and only
                // while the live certificate is active; the address line and
                // reasonText stay in the archive.
                snapshot: disclose ? {
                    province: snapshot.province ?? null,
                    district: snapshot.district ?? null,
                    subDistrict: snapshot.subDistrict ?? null,
                    farmName: snapshot.farmName ?? null,
                } : null,
            },
        });
    } catch (error) {
        logger.error('[Public] Revision verification error:', error);
        return res.status(500).json({
            success: false,
            message: 'เกิดข้อผิดพลาดในการตรวจสอบฉบับก่อนหน้า กรุณาลองใหม่อีกครั้ง',
        });
    }
});

/**
 * @route GET /verify/:certificateNumber/page
 * @desc Get verification page HTML (for embedding) - Server Side Rendered
 * @access Public
 */
router.get('/verify/:certificateNumber/page', publicVerifyLimiter, async (req, res) => {
    try {
        const { certificateNumber } = req.params;

        const certificate = await certificateService.findByCertificateNumber(certificateNumber);

        // Prepare data for HTML generator
        const now = new Date();
        const isValid = certificate && certificate.status.toLowerCase() === 'active' && (!certificate.expiryDate || new Date(certificate.expiryDate) > now);

        // BE-CERT-02 fix (2026-06-04): mask the applicant name in the public HTML
        // page too — the JSON endpoint masks via maskApplicantName, but the /page
        // variant rendered the raw full name, defeating the PR-1.5 anti-scraping
        // control. Now both paths mask (last name → initial) and both are
        // publicVerifyLimiter-rate-limited.
        //
        // M1: the holder row is computed from the RAW row (before the
        // applicantName mask is applied) so a juristic holder is not masked and
        // a person-shaped one is not masked twice.
        const maskedCertificate = certificate
            ? {
                ...certificate,
                applicantName: maskApplicantName(certificate.applicantName),
                holderDisplayName: holderNameForDisplay(certificate),
            }
            : certificate;
        const html = generateVerificationHTML({
            certificateNumber,
            isValid,
            certificate: maskedCertificate,
            verificationTimestamp: new Date(),
        });

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(html);
    } catch (error) {
        logger.error('[Public] Verification page error:', error);
        return res.status(500).send('<html><body>เกิดข้อผิดพลาด</body></html>');
    }
});

/**
 * HTML-escape a value before interpolating it into the verification page.
 * C5-02 (audit 2026-06-10): `certificateNumber` comes straight from req.params
 * and cert.* fields are applicant-controlled, so every dynamic value rendered
 * into this unauthenticated text/html response MUST be escaped — otherwise a
 * crafted URL segment / cert field is reflected/stored XSS.
 */
function escapeHtml(value) {
    if (value === null || value === undefined) {return '';}
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Generate verification HTML page
 */
function generateVerificationHTML({ certificateNumber, isValid, certificate, verificationTimestamp }) {
    const cert = certificate;

    return `
<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ตรวจสอบใบรับรอง GACP | ${escapeHtml(certificateNumber)}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { 
            font-family: 'Sarabun', sans-serif; 
            background: linear-gradient(135deg, #1b5e20 0%, #4caf50 100%); 
            min-height: 100vh; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            padding: 20px; 
        }
        .card { 
            background: white; 
            border-radius: 20px; 
            max-width: 500px; 
            width: 100%; 
            box-shadow: 0 20px 60px rgba(0,0,0,0.3); 
            overflow: hidden; 
        }
        .header { 
            background: ${isValid ? '#1b5e20' : '#dc2626'}; 
            color: white; 
            padding: 30px 20px; 
            text-align: center; 
        }
        .status-icon { font-size: 60px; margin-bottom: 10px; }
        .header h1 { font-size: 20px; margin-bottom: 5px; }
        .header p { font-size: 14px; opacity: 0.9; }
        .content { padding: 30px 20px; }
        .cert-number { 
            text-align: center; 
            font-size: 18px; 
            font-weight: bold; 
            color: #1b5e20; 
            margin-bottom: 20px; 
            padding: 15px; 
            background: #f0fdf4; 
            border-radius: 10px; 
        }
        .info-row { 
            display: flex; 
            justify-content: space-between; 
            padding: 12px 0; 
            border-bottom: 1px solid #e0e0e0; 
        }
        .info-label { color: #666; font-size: 14px; }
        .info-value { font-weight: 600; color: #333; text-align: right; }
        .footer { 
            background: #f5f5f5; 
            padding: 15px 20px; 
            text-align: center; 
            font-size: 12px; 
            color: #666; 
        }
        .badge { 
            display: inline-block; 
            padding: 5px 15px; 
            border-radius: 20px; 
            font-size: 14px; 
            font-weight: bold; 
        }
        .badge-valid { background: #dcfce7; color: #16a34a; }
        .badge-invalid { background: #fee2e2; color: #dc2626; }
    </style>
</head>
<body>
    <div class="card">
        <div class="header">
            <div class="status-icon">${isValid ? '✅' : '❌'}</div>
            <h1>${isValid ? 'ใบรับรองถูกต้อง' : 'ใบรับรองไม่ถูกต้อง'}</h1>
            <p>${isValid ? 'Certificate Verified' : 'Certificate Invalid or Expired'}</p>
        </div>
        <div class="content">
            <div class="cert-number">
                ${escapeHtml(certificateNumber)}
            </div>
            ${isValid && cert ? `
                <div class="info-row">
                    <span class="info-label">ชื่อแปลง</span>
                    <span class="info-value">${escapeHtml(cert.farmName || cert.siteName || '-')}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">ผู้ถือใบรับรอง</span>
                    <span class="info-value">${escapeHtml(cert.holderDisplayName || cert.applicantName || '-')}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">จังหวัด</span>
                    <span class="info-value">${escapeHtml(cert.province || '-')}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">พืชสมุนไพร</span>
                    <span class="info-value">${escapeHtml(cert.cropType || '-')}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">วันที่ออก</span>
                    <span class="info-value">${cert.issuedDate ? new Date(cert.issuedDate).toLocaleDateString('th-TH', { timeZone: DEFAULT_TIME_ZONE }) : '-'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">วันหมดอายุ</span>
                    <span class="info-value">${cert.expiryDate ? new Date(cert.expiryDate).toLocaleDateString('th-TH', { timeZone: DEFAULT_TIME_ZONE }) : '-'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">สถานะ</span>
                    <span class="info-value">
                        <span class="badge ${isValid ? 'badge-valid' : 'badge-invalid'}">
                            ${isValid ? 'ใช้งานได้' : 'ไม่สามารถใช้ได้'}
                        </span>
                    </span>
                </div>
            ` : `
                <p style="text-align: center; color: #666; padding: 20px;">
                    ไม่พบข้อมูลใบรับรอง หรือใบรับรองหมดอายุ
                </p>
            `}
        </div>
        <div class="footer">
            <p>ตรวจสอบเมื่อ: ${new Date(verificationTimestamp).toLocaleString('th-TH', { timeZone: DEFAULT_TIME_ZONE })}</p>
            <p>ระบบรับรองมาตรฐาน GACP สมุนไพร | GACP Thai Platform</p>
        </div>
    </div>
</body>
</html>
    `;
}

module.exports = router;
// Exported for unit tests + future readers that must apply the identical
// masking rule (same pattern as routes/api/finance/pricing.js:258).
module.exports.holderNameForDisplay = holderNameForDisplay;
