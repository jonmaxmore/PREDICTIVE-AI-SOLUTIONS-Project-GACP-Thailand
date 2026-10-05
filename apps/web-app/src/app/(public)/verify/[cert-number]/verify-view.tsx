import Link from 'next/link';
import { ShieldCheck, ShieldAlert, History } from 'lucide-react';
import { toCertificateSlug } from '@/lib/verify/public-verify-url';
import { mapIntegrity, type IntegrityPresentation } from '@/lib/verify/integrity-presentation';
import { formatThaiDate } from '@/lib/format/thai-date';

/**
 * Certificate revision (ฉบับแก้ไขภายใต้เลขเดิม) as the public verify endpoint
 * reports it (apps/backend/routes/api/auth/public.js): `null` at revision 1,
 * else the live revision number, when it was re-signed, the Thai label of the
 * reason CODE, and the archived revisions. The admin's free text (reasonText)
 * is never part of this contract and is never rendered.
 */
export interface VerifyRevisionHistoryEntry {
  no: number;
  signedAt: string | null;
  supersededAt: string | null;
}

export interface VerifyRevision {
  no: number;
  revisedAt: string | null;
  reasonLabel: string | null;
  history: VerifyRevisionHistoryEntry[];
}

/** Dates on the verifier are civil dates in Thailand, whatever the server's clock zone. */
const REVISION_DATE_OPTS: Intl.DateTimeFormatOptions = {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Bangkok',
};

/** "27 ส.ค. 2569" for an ISO timestamp; '' (not the epoch) on null / invalid. */
export function formatRevisionDate(value: string | null | undefined): string {
  return formatThaiDate(value, REVISION_DATE_OPTS, '');
}

function asIsoOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Narrow the backend's `data.revision` to the typed contract. Anything that is
 * not a revision past 1 (null, absent, malformed, `no` <= 1) is `null`, so a
 * backend that has not deployed the field yet renders exactly what it did
 * before. Only the contract's fields are copied; extra keys are dropped.
 */
function parseRevision(raw: unknown): VerifyRevision | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const no = typeof r.no === 'number' && Number.isInteger(r.no) ? r.no : null;
  if (no === null || no <= 1) return null;
  const historyRaw = Array.isArray(r.history) ? r.history : [];
  const history: VerifyRevisionHistoryEntry[] = historyRaw
    .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
    .filter((h) => typeof h.no === 'number' && Number.isInteger(h.no))
    .map((h) => ({
      no: h.no as number,
      signedAt: asIsoOrNull(h.signedAt),
      supersededAt: asIsoOrNull(h.supersededAt),
    }))
    .sort((a, b) => a.no - b.no);
  return {
    no,
    revisedAt: asIsoOrNull(r.revisedAt),
    reasonLabel: typeof r.reasonLabel === 'string' && r.reasonLabel.length > 0 ? r.reasonLabel : null,
    history,
  };
}

/**
 * Why a certificate is not valid, as the citizen reads it (ledger F-G4-57).
 *
 * The backend publishes a MACHINE code next to its unchanged English sentence
 * (apps/backend/routes/api/auth/public-verify-reason.js): the English is for
 * the API's existing consumers, this is the Thai a person standing in a shop
 * with a phone actually needs. `code` is null whenever the reason could not be
 * classified — the raw backend value is never shown to anyone.
 */
export interface VerifyStatusReason {
  code: string | null;
  title: string;
  detail: string;
  /** the renewal that replaced this certificate, when the backend resolved one */
  successorNumber: string | null;
  /**
   * The backend's English sentence, kept ONLY when this build could not
   * classify the code. It renders as a small third line under the Thai, so a
   * citizen facing an unknown reason still sees the real cause, and never sees
   * English as the only explanation.
   */
  reasonEN: string | null;
}

/** The renewal supersession code. */
const RENEWED_CODE = 'RENEWED';
/** Expiry wins over the stored status, so this is the code a renewed-then-expired certificate arrives with. */
const EXPIRED_CODE = 'EXPIRED';

/**
 * reasonCode → the Thai the citizen reads. A code that is not in this table
 * (an older or newer backend) falls back below rather than leaking an enum.
 */
const STATUS_REASON_COPY_TH: Readonly<Record<string, { title: string; detail: string }>> = Object.freeze({
  [EXPIRED_CODE]: {
    title: 'ใบรับรองหมดอายุแล้ว',
    detail: 'ใบรับรองฉบับนี้พ้นวันหมดอายุแล้ว สอบถามสถานะการต่ออายุได้จากผู้ถือใบรับรอง',
  },
  SUSPENDED: {
    title: 'ใบรับรองถูกระงับชั่วคราว',
    detail: 'หน่วยรับรองระงับการใช้ใบรับรองฉบับนี้ชั่วคราว ยังใช้อ้างอิงไม่ได้จนกว่าจะได้รับการคืนสถานะ',
  },
  REVOKED: {
    title: 'ใบรับรองถูกเพิกถอนแล้ว',
    detail: 'หน่วยรับรองเพิกถอนใบรับรองฉบับนี้แล้ว ใช้อ้างอิงไม่ได้อีก',
  },
  [RENEWED_CODE]: {
    title: 'ใบรับรองฉบับนี้ถูกแทนที่ด้วยฉบับต่ออายุแล้ว',
    detail: 'กรุณาตรวจสอบใบรับรองฉบับปัจจุบันแทน',
  },
  // The two commonest answers a citizen actually gets: a number that is not in
  // the register, and a QR whose verification code does not match the document.
  // Each names the cause and the next thing to do.
  NOT_FOUND: {
    title: 'ไม่พบใบรับรองเลขที่นี้ในทะเบียน',
    detail: 'ตรวจสอบเลขที่ใบรับรองบนเอกสารอีกครั้ง หรือสอบถามจากผู้ถือใบรับรอง',
  },
  CODE_MISMATCH: {
    title: 'รหัสตรวจสอบไม่ตรงกับใบรับรอง',
    detail: 'สแกน QR จากเอกสารฉบับจริงอีกครั้ง หรือสอบถามจากผู้ถือใบรับรอง',
  },
});

/**
 * An expired certificate that ALSO has a successor is two facts at once, and a
 * citizen needs both: this document is past its date, and there is a current
 * one to look at instead.
 */
const EXPIRED_WITH_SUCCESSOR_DETAIL_TH =
  'ใบรับรองฉบับนี้หมดอายุและมีฉบับต่ออายุแล้ว กรุณาตรวจสอบใบรับรองฉบับปัจจุบันแทน';

/**
 * Used whenever the backend gave nothing this build can classify.
 *
 * The detail names a NEXT ACTION, not just the dead end: a citizen who is told
 * only that no usable status was found has nowhere to go, and the two places
 * that can actually answer are the holder standing in front of them and the
 * certification body.
 */
const GENERIC_STATUS_TITLE_TH = 'ใบรับรองไม่ถูกต้อง';
const GENERIC_STATUS_DETAIL_TH =
  'ไม่พบสถานะที่ใช้อ้างอิงได้ของใบรับรองฉบับนี้ สอบถามจากผู้ถือใบรับรอง หรือติดต่อหน่วยรับรอง';

/**
 * The Thai copy for a reason code, or undefined.
 *
 * The OWN-property check is load-bearing: the table is a plain object, so a
 * code reading 'constructor' or '__proto__' used to resolve to an inherited
 * value of Object.prototype, whose `.title` is undefined — the citizen would
 * have been shown a blank hero. A code counts only when the table owns it.
 */
function statusReasonCopy(code: string | null): { title: string; detail: string } | undefined {
  if (!code) return undefined;
  return Object.prototype.hasOwnProperty.call(STATUS_REASON_COPY_TH, code)
    ? STATUS_REASON_COPY_TH[code]
    : undefined;
}

/**
 * The status reason for a certificate that is NOT status-valid, or null when it
 * is (a valid certificate has nothing to explain).
 *
 * A backend older (or newer) than this page still says something true: an
 * unclassifiable code falls back to the generic Thai, and its English `reason`
 * rides along as `reasonEN` for the small third line — English is evidence
 * beside the Thai, never the only thing the citizen is given.
 */
function parseStatusReason(
  statusValid: boolean,
  data: { reason?: string | null; reasonCode?: string | null; renewal?: { successorCertificateNumber?: string | null } | null } | null,
): VerifyStatusReason | null {
  if (statusValid) return null;

  const rawCode = typeof data?.reasonCode === 'string' && data.reasonCode.length > 0 ? data.reasonCode : null;
  const copy = statusReasonCopy(rawCode);

  // The pointer to the replacement belongs to the CERTIFICATE, not to one
  // reason code. Expiry wins over the stored status on the wire, so a renewed
  // certificate that has since passed its expiryDate arrives as EXPIRED with
  // `renewal` still set (the backend publishes `renewal` only for a stored
  // status 'renewed'). Reading it only under RENEWED threw the successor away
  // in exactly the case a citizen most needs it.
  const successor = data?.renewal?.successorCertificateNumber;
  const successorNumber = typeof successor === 'string' && successor.length > 0 ? successor : null;

  if (!copy) {
    const reason = typeof data?.reason === 'string' && data.reason.length > 0 ? data.reason : null;
    return {
      code: null,
      title: GENERIC_STATUS_TITLE_TH,
      detail: GENERIC_STATUS_DETAIL_TH,
      successorNumber,
      reasonEN: reason,
    };
  }

  // Expired AND replaced: one sentence that carries both facts, above the link.
  const detail =
    rawCode === EXPIRED_CODE && successorNumber ? EXPIRED_WITH_SUCCESSOR_DETAIL_TH : copy.detail;

  return { code: rawCode, title: copy.title, detail, successorNumber, reasonEN: null };
}

/**
 * Crypto-trust view-model + presentational verdict for the public cert-verify
 * page. Lives in a sibling module (NOT page.tsx) because Next.js restricts which
 * names a route module may export — extra exports trip the generated
 * `.next/types/.../page.ts` validator. Keeping them here also makes them cleanly
 * unit-testable via renderToStaticMarkup without the async server component.
 *
 * `statusValid` (status + expiry, from the backend `verified` flag) is SEPARATE
 * from `heroOk` (whether the GREEN crypto-verified hero may show). The green hero
 * requires BOTH: a status-valid cert AND a passing crypto verdict. A status-valid
 * cert whose integrity is TAMPERED / signatureValid:false flips the hero RED
 * (heroTone:'danger'); an UNSIGNED cert keeps the status display but withholds
 * the green crypto chip.
 */
export interface VerifyView {
  statusValid: boolean;
  heroOk: boolean;
  heroTone: IntegrityPresentation['tone'] | 'success';
  crypto: IntegrityPresentation;
  /** crypto evidence present (endpoint returned an integrity verdict) */
  hasIntegrity: boolean;
  /** show the green "ตรวจสอบลายเซ็นดิจิทัลแล้ว" chip */
  showVerifiedChip: boolean;
  /** legacy unsigned cert → amber note, no green chip */
  isUnsigned: boolean;
  /** first 16 hex of the public-key fingerprint, for offline verification */
  fingerprintShort: string | null;
  /**
   * Certificate revision past 1, or null. Informational only: it never
   * touches heroTone / heroOk / showVerifiedChip. A corrected certificate is
   * as trusted as an uncorrected one; the line just says it was corrected.
   */
  revision: VerifyRevision | null;
  /**
   * Why this certificate is not valid, in Thai, with the renewal it was
   * replaced by when there is one. Null for a status-valid certificate.
   */
  statusReason: VerifyStatusReason | null;
}

export function deriveVerifyView(result: unknown): VerifyView {
  const r = (result ?? null) as
    | {
        verified?: boolean;
        data?: {
          integrity?: string | null;
          signatureValid?: boolean | null;
          sealed?: boolean;
          publicKeyFingerprint?: string | null;
          revision?: unknown;
          reason?: string | null;
          reasonCode?: string | null;
          renewal?: { successorCertificateNumber?: string | null } | null;
        } | null;
      }
    | null;

  const statusValid = r?.verified === true;
  const data = r?.data ?? null;
  const integrity = data?.integrity ?? undefined;
  const signatureValid = data?.signatureValid ?? undefined;
  const hasIntegrity = typeof integrity === 'string' && integrity.length > 0;

  const crypto = mapIntegrity(integrity, signatureValid);

  // The GREEN hero requires BOTH a status-valid cert AND a passing crypto
  // verdict. Tamper/signature-fail (crypto.tone === 'danger') overrides green.
  const heroOk = statusValid && crypto.heroOk;
  // Hero tone: danger when crypto says tampered (even if status is valid),
  // otherwise green only when both pass, else fall back to the status colour.
  const heroTone: VerifyView['heroTone'] =
    crypto.tone === 'danger' ? 'danger' : heroOk ? 'success' : statusValid ? 'success' : 'danger';

  const fp = data?.publicKeyFingerprint;
  const fingerprintShort =
    typeof fp === 'string' && /^[0-9a-fA-F]{16,}$/.test(fp) ? fp.slice(0, 16) : null;

  return {
    statusValid,
    heroOk,
    heroTone,
    crypto,
    hasIntegrity,
    // Only a genuinely-verified (heroOk) cert earns the green chip.
    showVerifiedChip: heroOk,
    isUnsigned: integrity === 'UNSIGNED',
    fingerprintShort,
    revision: parseRevision(data?.revision),
    statusReason: parseStatusReason(statusValid, data),
  };
}

/**
 * The status hero's copy for a certificate that is NOT valid: the Thai reason
 * (bold), the detail, the backend's English sentence when the code could not be
 * classified, and — whenever a successor was resolved — a link to the
 * certificate that replaced it, so a citizen scanning an obsolete QR is not
 * left at a dead end. Renders nothing for a valid certificate.
 *
 * A fragment, not a wrapper: it slots into the hero's existing text column, so
 * the red hero is unchanged apart from the words in it.
 */
export function StatusReason({ view }: { view: VerifyView }) {
  const reason = view.statusReason;
  if (!reason) return null;

  return (
    <>
      <p className="text-base font-bold text-red-700">{reason.title}</p>
      <p className="text-xs text-red-700">{reason.detail}</p>
      {/* The backend's own English sentence, only when this build could not
          classify the code. It reads as supporting evidence rather than the
          answer because it is unbolded and comes last — NOT because it is
          faded: at text-red-700/70 on the hero's bg-red-50 it measured ~3.6:1,
          under the WCAG AA 4.5:1 floor, so the one line carrying the real cause
          was the hardest one on the page to read. Full-strength is ~5.9:1. */}
      {reason.reasonEN && <p className="text-xs text-red-700">{reason.reasonEN}</p>}
      {reason.successorNumber && (
        // A certificate number is data, not a path: '#' or '/' in one would cut
        // the link short and send the citizen to the wrong page (or none).
        <Link
          href={`/verify/${encodeURIComponent(toCertificateSlug(reason.successorNumber))}`}
          className="mt-1 inline-block text-xs font-semibold text-red-700 underline underline-offset-2"
        >
          {'ตรวจสอบฉบับปัจจุบัน ' + reason.successorNumber}
        </Link>
      )}
    </>
  );
}

/**
 * One neutral line under the status hero for a certificate past revision 1:
 * "ฉบับแก้ไขครั้งที่ n · <date> · <reason label>" and a link to the archived
 * previous revision. Muted colours on purpose: this is information, not a
 * verdict, so it must not borrow the hero's green or red.
 */
export function RevisionLine({ revision, certNumber }: { revision: VerifyRevision; certNumber: string }) {
  const correctionCount = revision.no - 1;
  const previousNo = revision.no - 1;
  const date = formatRevisionDate(revision.revisedAt);
  const line = [`ฉบับแก้ไขครั้งที่ ${correctionCount}`, date, revision.reasonLabel]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' · ');
  const base = `/verify/${encodeURIComponent(toCertificateSlug(certNumber))}/revision/`;
  const older = revision.history.filter((h) => h.no < previousNo);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-muted px-6 py-3 text-xs text-muted-foreground">
      <History className="h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="leading-snug">{line}</p>
      <Link href={`${base}${previousNo}`} className="font-semibold underline underline-offset-2 hover:text-foreground">
        ดูฉบับก่อนหน้า
      </Link>
      {older.map((h) => (
        <Link key={h.no} href={`${base}${h.no}`} className="underline underline-offset-2 hover:text-foreground">
          ฉบับที่ {h.no}
        </Link>
      ))}
    </div>
  );
}

/**
 * Presentational crypto-verdict strip rendered under the status hero. Honest by
 * construction: it only shows a positive "verified" chip when `showVerifiedChip`
 * is true; TAMPERED → red callout; UNSIGNED → amber legacy note; no integrity →
 * renders nothing (the status display already stands on its own).
 */
export function CryptoVerdict({ view }: { view: VerifyView }) {
  // Tamper / signature failure — strongest negative signal, always surface it.
  if (view.crypto.tone === 'danger') {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-red-700">
        <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="leading-snug">
          <p className="text-sm font-bold">{view.crypto.labelTH}</p>
          <p className="text-xs">{view.crypto.labelEN}</p>
        </div>
      </div>
    );
  }

  // Verified — only when both status AND crypto pass.
  if (view.showVerifiedChip) {
    return (
      <div className="rounded-xl bg-leaf-soft px-4 py-3 text-leaf-onSoft">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
          <p className="text-sm font-bold">{view.crypto.labelTH} ✓</p>
        </div>
        {/* font-mono has no Thai glyphs, so the label rendered in a fallback face
            while the fingerprint rendered monospace — two typefaces in one line.
            Only the HEX needs the monospace treatment. */}
        {view.fingerprintShort && (
          <p className="mt-1 text-[11px] text-leaf-onSoft">
            ลายนิ้วมือกุญแจสาธารณะ:{' '}
            <span className="break-all font-mono">{view.fingerprintShort}</span>…
          </p>
        )}
      </div>
    );
  }

  // Amber caution whenever there IS an integrity verdict but it is not a
  // positive "verified" claim: a legacy UNSIGNED cert, OR a 'VALID' hash with no
  // verified signature (signatureValid null — the downgrade-attack / signing-
  // outage case, mapped to a warning by mapIntegrity rule 2's guard). Honest:
  // the content may match its stored hash, but without a verified RSA signature
  // its authenticity is unconfirmed.
  if (view.hasIntegrity && view.crypto.tone === 'warning') {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-amber-700">
        <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="leading-snug">
          <p className="text-sm font-bold">{view.crypto.labelTH}</p>
          <p className="text-xs">{view.crypto.labelEN}</p>
        </div>
      </div>
    );
  }

  // No integrity evidence at all (endpoint didn't return it) → render nothing;
  // the status display alone is shown without any (un)verified crypto assertion.
  return null;
}
