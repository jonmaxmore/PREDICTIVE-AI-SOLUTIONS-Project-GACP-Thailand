/**
 * integrity-presentation — the ONE source of truth for translating the backend
 * cert-verify crypto verdict into a UI presentation triple.
 *
 * Batch 1 (crypto-trust) FE. The public cert-verify endpoint
 * (GET /api/v1/public/verify/:n, apps/backend/routes/api/auth/public.js) returns:
 *   data.integrity       — 'VALID' | 'TAMPERED' | 'UNSIGNED'
 *   data.signatureValid  — true | false | null (null = the cert is unsigned, so
 *                          the RSA verdict is "not applicable", NOT "failed")
 *
 * This helper maps that pair to:
 *   tone     — Badge/strip tone token ('success' | 'warning' | 'danger')
 *   heroOk   — whether the page may render its GREEN "crypto-verified" hero.
 *              FALSE for everything except a genuinely-verified cert, so we can
 *              never assert crypto-safety without evidence. (The page's own
 *              status/expiry check is SEPARATE — heroOk only gates the crypto
 *              chip / the crypto override of the hero.)
 *   labelTH/labelEN — the human-readable verdict copy.
 *
 * Ordering of the verdict rules matters: a signature failure (signatureValid ===
 * false) or a hash mismatch (integrity === 'TAMPERED') is the strongest signal
 * and DOMINATES — it must win even if integrity claims 'VALID' (a re-signed
 * forgery) or 'UNSIGNED'.
 */

export type IntegrityTone = 'success' | 'warning' | 'danger';

export interface IntegrityPresentation {
    tone: IntegrityTone;
    heroOk: boolean;
    labelTH: string;
    labelEN: string;
}

export function mapIntegrity(
    integrity?: string | null,
    signatureValid?: boolean | null,
): IntegrityPresentation {
    // 1. RED (TAMPERED) — driven ONLY by the hash recompute, which is
    //    key-INDEPENDENT and reliable: 'TAMPERED' means the live row no longer
    //    matches the documentHash stamped at issuance. We deliberately do NOT
    //    red-flag on `signatureValid === false`: signature verification depends
    //    on the verifying key matching the key that SIGNED the cert, so a key
    //    rotation / re-provision (proven to happen on staging: existing certs
    //    verify false against the current key) would otherwise render EVERY
    //    legitimate government certificate as "TAMPERED" — a far worse
    //    public-trust failure than the bug. A failed/absent signature is an amber
    //    caution (rule 3), never a red tamper claim.
    if (integrity === 'TAMPERED') {
        return {
            tone: 'danger',
            heroOk: false,
            labelTH: 'เอกสารถูกแก้ไข ไม่ตรงกับต้นฉบับ',
            labelEN: 'TAMPERED — does not match the issued record',
        };
    }

    // 2. GREEN — hash matches AND the RSA signature genuinely VERIFIED
    //    (signatureValid === true). Requires a real verified signature, not
    //    merely the absence of a false: the documentHash is an UNKEYED SHA-256
    //    over public fields, so a DB-write attacker can recompute a matching hash
    //    (→ integrity:'VALID'). Only the RSA signature (which needs the private
    //    key) carries non-repudiation, so only signatureValid===true earns the
    //    green "Digitally verified" claim.
    if (integrity === 'VALID' && signatureValid === true) {
        return {
            tone: 'success',
            heroOk: true,
            labelTH: 'ตรวจสอบลายเซ็นดิจิทัลแล้ว',
            labelEN: 'Digitally verified',
        };
    }

    // 3. AMBER — hash matches but the digital signature was NOT confirmed
    //    (signatureValid false or null): a legacy/unsigned cert, a signing
    //    outage, a verifying-key mismatch, OR an unkeyed-hash forgery attempt.
    //    We cannot distinguish these, so we make no positive claim and no red
    //    alarm — an honest "authenticity not confirmed" caution. The page's
    //    status hero (active/not-expired) is shown separately and stays green.
    if (integrity === 'VALID') {
        return {
            tone: 'warning',
            heroOk: false,
            labelTH: 'ยืนยันลายเซ็นดิจิทัลไม่ได้',
            labelEN: 'Signature not verified',
        };
    }

    // 4. AMBER — legacy unsigned cert (no documentHash at all).
    if (integrity === 'UNSIGNED') {
        return {
            tone: 'warning',
            heroOk: false,
            labelTH: 'ใบรับรองรุ่นเก่า ไม่มีลายเซ็นดิจิทัล',
            labelEN: 'Legacy certificate — unsigned',
        };
    }

    // 5. AMBER — unknown / missing integrity (endpoint didn't return it, or an
    //    unrecognised value). SAFE default: NEVER a positive "verified" claim.
    return {
        tone: 'warning',
        heroOk: false,
        labelTH: 'ไม่สามารถยืนยันลายเซ็นดิจิทัล',
        labelEN: 'Signature not verified',
    };
}
