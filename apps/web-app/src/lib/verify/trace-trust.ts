/**
 * trace-trust — gate the public TRACE surfaces' trust wording on the fields the
 * trace responses ACTUALLY carry, keeping TWO independent signals SEPARATE:
 *
 *   data.certificate.isValid  — the GACP certification STATUS (cert ACTIVE and
 *                               not expired). This is the "GACP Certified" claim
 *                               and gates the green badge / hero / certified
 *                               timeline step.
 *   data.verification.valid   — the cryptographic QR-SEAL verdict. FAIL-CLOSED:
 *                               true ONLY when the QR was cryptographically
 *                               sealed AND verified (RSA-SHA256). This gates ONLY
 *                               the seal caption / seal chip wording.
 *
 * CORE INVARIANT (M3): these two MUST NOT be conflated into one badge. A legit
 * certified product whose QR seal can't be confirmed still shows "GACP Certified"
 * (status), with a SEPARATE honest seal line — it is NOT flipped to a red
 * "Unverified" product. The trace responses do NOT carry the cert RSA
 * `signatureValid` (that lives only on the dedicated cert-verify path), so the
 * positive seal caption is gated on `verification.valid` alone.
 *
 * A cycle-granularity scan has NO seal at its own level (the seal lives at the
 * plot/batch/lot level), so the backend reports verification.valid as
 * null/undefined there: the seal line then reads NEUTRAL ("not verified"), never
 * a red invalidation of the product.
 */

export interface TraceTrust {
  /** the GACP certification STATUS — gates the green "GACP Certified" badge/hero/timeline step */
  certified: boolean;
  /** the cryptographic QR-SEAL verdict — gates ONLY the positive seal caption/chip */
  sealVerified: boolean;
  /**
   * @deprecated retained for callers that have not migrated. Equals `certified`
   * (the product-trust signal). NEVER use this to gate the seal caption — use
   * `sealVerified`. The product badge must follow certification STATUS, not the
   * seal verdict, so a certified-but-unsealed product is not flipped to red.
   */
  verified: boolean;
  /** Thai headline — follows certification STATUS (certified), not the seal */
  titleTH: string;
  /** Thai caption under the headline — follows certification STATUS */
  captionTH: string;
}

export function deriveTraceTrust(
  certIsValid?: boolean | null,
  verificationValid?: boolean | null,
): TraceTrust {
  const certified = certIsValid === true;
  const sealVerified = verificationValid === true;
  return {
    certified,
    sealVerified,
    // product-trust signal === certification status (NOT the seal verdict)
    verified: certified,
    titleTH: certified ? 'ผ่านการรับรองมาตรฐาน GACP' : 'ยังไม่ได้รับการรับรอง GACP',
    captionTH: certified
      ? 'สมุนไพรนี้ผ่านการรับรองมาตรฐาน GACP โดย DTAM'
      : 'ไม่พบใบรับรอง GACP ที่ใช้งานได้สำหรับผลิตภัณฑ์นี้',
  };
}

/**
 * Seal-line caption for the trace surface — gated SOLELY on the cryptographic QR
 * verdict (trust.sealVerified). When the seal is confirmed it states the
 * RSA-SHA256 claim; otherwise it returns a NEUTRAL honest note ("QR seal not
 * verified") — it does NOT invalidate the product (that is the certified badge's
 * job, gated on certification status). This replaces the old UNCONDITIONAL
 * "ตรวจสอบด้วยลายเซ็นดิจิทัล (RSA-SHA256)" claim.
 */
export function traceVerificationCaption(trust: TraceTrust): string {
  return trust.sealVerified
    ? 'ยืนยันความถูกต้องของรหัส QR ด้วยลายเซ็นดิจิทัล (RSA-SHA256) โดย DTAM GACP'
    : 'ยังไม่ได้ยืนยันลายเซ็นดิจิทัลของรหัส QR นี้ (QR seal not verified)';
}
