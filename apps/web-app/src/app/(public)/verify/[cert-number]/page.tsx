export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck, CheckCircle, XCircle, ArrowLeft, Leaf, AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/primitives/card';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { QrImage } from '@/components/ui/qr-image';
import { qrRenderOptions } from '@/lib/qr/qr-render-options';
import QRCode from 'qrcode';
import { headers } from 'next/headers';
import { buildPublicVerifyUrl, buildPublicVerifyPageUrl, toCertificateSlug, resolvePublicOrigin } from '@/lib/verify/public-verify-url';
import { formatThaiDate, THAI_TIME_ZONE } from '@/lib/format/thai-date';
import { deriveVerifyView, CryptoVerdict, RevisionLine, StatusReason } from './verify-view';
import { CERTIFICATE_ISSUER_TH } from '@/constants/service-facts';

const QR_SIZE = 176;

export const metadata: Metadata = {
  title: 'ตรวจสอบใบรับรอง GACP | Certificate Verification',
  description: 'ตรวจสอบความถูกต้องของใบรับรอง GACP สมุนไพร',
};

/**
 * Discriminated fetch outcome so the page can tell "the backend answered"
 * apart from "we could not reach the backend at all". The backend's verify
 * route answers HTTP 200 for EVERY definitive verdict — not-found, expired,
 * suspended, and revoked all come back as 200 + verified:false + reason
 * (apps/backend/routes/api/auth/public.js). So any non-2xx here is
 * infrastructure (proxy down, 5xx, rate-limit), never a verdict, and must
 * NEVER render the red "Certificate Invalid" hero — that would publicly
 * brand a farmer's genuine certificate as fake every time the backend blinks.
 */
// `publicOrigin` rides along on both variants — it's resolved from the SAME
// `headers()` call this function already makes for the backend fetch below,
// so the page component never has to call `headers()` a second time just to
// build the QR's URL (fix-round 1, review 6712f985).
type FetchOutcome =
    | { kind: 'ok'; payload: VerifyPayload | null; publicOrigin: string }
    | { kind: 'unavailable'; publicOrigin: string };

/** The slice of the backend verify envelope this page actually renders. */
interface VerifyPayload {
  data?: {
    /** The register's own number (the printed form) — what the page shows, never the typed URL param. */
    certificateNumber?: string;
    certificate?: {
      farmName?: string;
      applicantName?: string;
      /**
       * M1 (2026-08-15): the certificate is held by the farm/entity, the person
       * merely submitted it. The backend adds this next to the old masked
       * `applicantName` (apps/backend/routes/api/auth/public.js
       * holderNameForDisplay) — it is ADDITIVE, so a backend that has not
       * deployed M1 yet simply omits it and this page falls back.
       */
      holderDisplayName?: string;
      province?: string;
      cropTypes?: string[];
      issueDate?: string;
      expiryDate?: string;
      standards?: string[];
    };
    reason?: string;
    /**
     * F-G4-57 (ADDITIVE): the machine reason code beside the English `reason`,
     * and the renewal that superseded this certificate. A backend that has not
     * deployed them omits both, and the page falls back to the English reason.
     */
    reasonCode?: string | null;
    renewal?: { successorCertificateNumber?: string | null } | null;
    verifiedAt?: string;
  } | null;
}

async function fetchCertificate(certNumber: string): Promise<FetchOutcome> {
  // C1 (audit 2026-06-30, staging-corrected x3): build the verify URL from the
  // INCOMING REQUEST host so nginx routes it to the SAME-environment backend, and
  // buildPublicVerifyUrl adds the `/api/v1` segment (the original bug was only the
  // missing `/api/v1`). Why the request host and not an env var: NEXT_PUBLIC_* is
  // INLINED AT BUILD TIME (the build-time value, empty) even in server components,
  // not read at runtime; INTERNAL_API_URL/BACKEND_URL are unset (→ localhost:8000,
  // unreachable from the frontend container); http://backend:8000 cross-wires
  // staging→the PROD backend on the shared droplet. The incoming x-forwarded-host
  // (the public host the citizen hit: staging.gacpth.com / gacpth.com) is the only
  // runtime, env-agnostic, per-env-correct source — proven: a server-side fetch to
  // https://staging.gacpth.com/api/v1/public/verify/<n> returns verified:true.
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || 'https';
  // S1 hardening (review 6712f985): the QR/verify-link origin is resolved
  // through an allowlist — see resolvePublicOrigin's docstring — so a
  // forged x-forwarded-host can't make this page mint a verify link that
  // points somewhere the requester chose. This does NOT change the
  // BACKEND fetch below, which intentionally keeps trusting the raw host
  // per the comment above (that is the established, per-environment
  // routing behaviour, unrelated to what a QR encodes).
  const publicOrigin = resolvePublicOrigin(host, proto);
  if (!host) return { kind: 'unavailable', publicOrigin };
  const url = buildPublicVerifyUrl(`${proto}://${host}`, certNumber);
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (res.ok) return { kind: 'ok', payload: await res.json(), publicOrigin };
    return { kind: 'unavailable', publicOrigin };
  } catch {
    return { kind: 'unavailable', publicOrigin };
  }
}

export default async function PublicCertVerifyPage({
  params,
}: {
  params: Promise<{ 'cert-number': string }>;
}) {
  const routeParams = await params;
  const typedNumber = routeParams['cert-number'];
  const outcome = await fetchCertificate(typedNumber);
  const unavailable = outcome.kind === 'unavailable';
  const result = unavailable ? null : outcome.payload;

  const view = deriveVerifyView(result);
  // The STATUS hero is driven by status-validity (heroTone === 'success' iff the
  // cert is status-valid AND not crypto-tampered). It must NOT be gated on
  // view.heroOk — that would render a perfectly valid UNSIGNED/legacy cert (or a
  // valid cert when the backend hasn't deployed the integrity fields yet) as RED
  // "Certificate Invalid". The crypto verdict only ever DOWNGRADES the hero to
  // red (heroTone === 'danger' on genuine TAMPERED/signature-fail); the green
  // "Digitally verified" chip (view.showVerifiedChip) is what requires a signature.
  // heroTone is two-valued ('success' | 'danger'), so !isValid IS the danger
  // hero; the old separate `heroDanger` flag now has no second reader.
  const isValid = view.heroTone === 'success';
  const cert = result?.data?.certificate;
  // Shown and linked: the stored number when the register answered, else what was typed.
  const certNumber = result?.data?.certificateNumber || typedNumber;

  // The QR must encode THIS page's own public URL (what a phone camera
  // should open), not the internal backend API URL `buildPublicVerifyUrl`
  // builds above for the server-side data fetch. `outcome.publicOrigin` was
  // already resolved (allowlisted) inside fetchCertificate from the SAME
  // headers() call that fetch used — no second headers() call needed here.
  const publicVerifyPageUrl = buildPublicVerifyPageUrl(outcome.publicOrigin, certNumber);

  // SSR pre-render (fix-round 1, review 6712f985): generate the actual data
  // URL server-side so no-JS / crawler / first-paint requests see a real,
  // scannable code instead of the client-effect loading box. Same options
  // QrImage itself uses (qrRenderOptions) — best-effort: on failure,
  // `initialDataUrl` stays null and QrImage's own client-side effect (or
  // fallbackSrc) takes over, exactly as before this change.
  const ssrQrDataUrl = await QRCode.toDataURL(publicVerifyPageUrl, qrRenderOptions(QR_SIZE)).catch(
    () => null,
  );

  return (
    <div className="flex min-h-screen flex-col bg-mint-bg">
      {/* Marketing header — clean white lockup */}
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b border-primary-100 bg-card/90 px-5 backdrop-blur-sm dark:border-border sm:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft">
            <Leaf className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-bold text-primary">ระบบรับรอง GACP</span>
            <span className="block text-[10px] text-muted-foreground">กรมการแพทย์แผนไทยและการแพทย์ทางเลือก</span>
          </span>
        </Link>
        <span className="hidden items-center gap-1.5 rounded-full bg-leaf-soft px-3 py-1 text-xs font-semibold text-leaf-onSoft sm:inline-flex">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          ตรวจสอบใบรับรองสาธารณะ
        </span>
      </header>

      <main className="flex flex-1 justify-center px-4 py-10 sm:py-14">
        <div className="w-full max-w-xl">
          {/* Eyebrow + title */}
          <div className="mb-6 text-center">
            <p className="text-xs font-bold uppercase text-leaf-800 dark:text-leaf-onSoft">
              ตรวจสอบใบรับรองสาธารณะ
            </p>
            <h1 className="mt-2 text-2xl font-bold leading-snug text-primary">
              ผลการตรวจสอบใบรับรอง
            </h1>
          </div>

          <Card className="overflow-hidden">
            {/* Status result strip. The hero is GREEN only when the cert is
                both status-valid AND crypto-verified. A status-valid cert whose
                content was TAMPERED / re-signed (view.heroTone === 'danger')
                flips the hero RED and overrides the green copy. */}
            {unavailable ? (
              /* Transport/server failure — NO verdict was reached. Neutral
                 amber, never the red "invalid" hero: a farmer's genuine
                 certificate must not be publicly branded fake because the
                 backend was unreachable for a moment. */
              <div role="status" className="flex items-center gap-3 bg-amber-50 px-6 py-5">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
                  <AlertTriangle className="h-7 w-7" aria-hidden="true" />
                </span>
                <div className="leading-snug">
                  <p className="text-base font-bold text-amber-800">ไม่สามารถตรวจสอบได้ในขณะนี้</p>
                  <p className="text-xs text-amber-700">
                    ระบบตรวจสอบขัดข้องชั่วคราว ยังไม่สามารถยืนยันสถานะใบรับรองได้ กรุณาลองใหม่อีกครั้ง
                  </p>
                  <p className="text-xs text-amber-700">
                    Verification temporarily unavailable — no verdict was reached. Please try again.
                  </p>
                </div>
              </div>
            ) : (
              <div
                className={`flex items-center gap-3 px-6 py-5 ${
                  isValid ? 'bg-leaf-soft' : 'bg-red-50'
                }`}
              >
                <span
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white ${
                    isValid ? 'bg-leaf' : 'bg-red-500'
                  }`}
                >
                  {isValid ? (
                    <CheckCircle className="h-7 w-7" aria-hidden="true" />
                  ) : (
                    <XCircle className="h-7 w-7" aria-hidden="true" />
                  )}
                </span>
                <div className="leading-snug">
                  {/* F-G4-57: a certificate that is not valid is told WHY in
                      Thai (expired / suspended / revoked / replaced by a
                      renewal), with a link to the current certificate when it
                      was renewed — instead of the old 'ใบรับรองไม่ถูกต้อง' over
                      the backend's English sentence. The hero itself stays red;
                      only the words change. The TAMPERED branch is untouched. */}
                  {!isValid && view.statusReason ? (
                    <StatusReason view={view} />
                  ) : (
                    <>
                      <p
                        className={`text-base font-bold ${
                          isValid ? 'text-leaf-onSoft' : 'text-red-700'
                        }`}
                      >
                        {isValid
                          ? 'ใบรับรองถูกต้องและยังมีผลบังคับใช้'
                          : 'เอกสารถูกแก้ไข ไม่ตรงกับต้นฉบับ'}
                      </p>
                      <p className={`text-xs ${isValid ? 'text-leaf-onSoft' : 'text-red-700'}`}>
                        {isValid
                          ? 'Valid & active certificate'
                          : 'TAMPERED — does not match the issued record'}
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Certificate revision (ฉบับแก้ไขภายใต้เลขเดิม) — one neutral
                line, only when the backend says the document is past
                revision 1. Informational: never changes the hero above. */}
            {!unavailable && view.revision && (
              <RevisionLine revision={view.revision} certNumber={certNumber} />
            )}

            {/* Crypto-trust verdict — additive, sits under the status hero.
                Honest: shows a verified chip only on genuine evidence,
                a red callout on tamper, an amber note for legacy unsigned. */}
            {view.hasIntegrity && (
              <div className="border-b border-primary-100 px-6 pb-4 pt-4">
                <CryptoVerdict view={view} />
              </div>
            )}

            {/* Body — QR + details */}
            <div className="flex flex-col gap-6 p-6 sm:flex-row">
              <div className="flex shrink-0 flex-col items-center text-center sm:items-start">
                {/* QR modules need true white behind them to keep scan
                    contrast — this must NOT flip under dark mode. */}
                <div className="rounded-2xl border border-primary-100 bg-white p-3 dark:bg-white">
                  <QrImage
                    value={publicVerifyPageUrl}
                    alt={`QR ตรวจสอบใบรับรอง ${certNumber}`}
                    size={QR_SIZE}
                    className="h-44 w-44"
                    initialDataUrl={ssrQrDataUrl}
                  />
                </div>
                <p className="mt-2 w-full text-center text-[11px] text-muted-foreground">สแกนเพื่อตรวจสอบ</p>
              </div>

              <div className="flex flex-1 flex-col gap-3">
                <div className="rounded-xl bg-mint-soft p-3 text-center font-mono text-lg font-bold text-leaf-onSoft">
                  {certNumber}
                </div>

                {cert ? (
                  <>
                    {cert.farmName && <InfoRow label="ชื่อแปลง" value={cert.farmName} />}
                    {/* M1: one row, one meaning — who HOLDS this certificate.
                        holderDisplayName arrives already masked-or-not by the
                        backend rule (a company name is public, a person's is
                        masked); pre-M1 rows fall back to the old applicantName. */}
                    {(cert.holderDisplayName ?? cert.applicantName) && (
                      <InfoRow label="ผู้ถือใบรับรอง" value={(cert.holderDisplayName ?? cert.applicantName) as string} />
                    )}
                    {cert.province && <InfoRow label="จังหวัด" value={cert.province} />}
                    {cert.cropTypes && cert.cropTypes.length > 0 && <InfoRow label="พืชสมุนไพร" value={cert.cropTypes.join(', ')} />}
                    {cert.issueDate && <InfoRow label="วันที่ออก" value={formatDate(cert.issueDate)} />}
                    {cert.expiryDate && <InfoRow label="วันหมดอายุ" value={formatDate(cert.expiryDate)} />}
                    {cert.standards && cert.standards.length > 0 && <InfoRow label="มาตรฐาน" value={cert.standards.join(', ')} />}
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs text-muted-foreground">สถานะ</span>
                      <Badge tone={isValid ? 'success' : 'danger'}>
                        <span
                          className={`mr-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                            isValid ? 'bg-leaf-600' : 'bg-red-500'
                          }`}
                          aria-hidden="true"
                        />
                        {isValid ? 'รับรองแล้ว' : 'ไม่ถูกต้อง'}
                      </Badge>
                    </div>
                  </>
                ) : unavailable ? (
                  <div className="flex flex-col items-center gap-3 py-4 text-center">
                    <p className="text-sm text-muted-foreground">
                      ยังไม่สามารถแสดงข้อมูลใบรับรองได้ เนื่องจากระบบขัดข้องชั่วคราว
                    </p>
                    {/* Button renders a plain <a> for href, so the retry
                        always re-runs this server component's fetch. */}
                    <Button
                      href={`/verify/${encodeURIComponent(toCertificateSlug(certNumber))}`}
                      variant="outline"
                      className="border-amber-300 text-amber-700 hover:bg-amber-50"
                    >
                      ลองตรวจสอบอีกครั้ง
                    </Button>
                  </div>
                ) : (
                  <p className="py-4 text-center text-sm text-muted-foreground">ไม่พบข้อมูลใบรับรอง</p>
                )}
              </div>
            </div>

            {/* Footer meta */}
            <div className="border-t border-primary-100 bg-mint-soft px-6 py-4 text-center">
              <p className="text-[11px] text-muted-foreground">
                {unavailable
                  ? 'ยังไม่มีการตรวจสอบ เนื่องจากระบบขัดข้องชั่วคราว'
                  : `ตรวจสอบเมื่อ ${formatCheckedAt(result?.data?.verifiedAt || Date.now())}`}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">ระบบรับรองมาตรฐาน GACP สมุนไพร | GACP Thai Platform</p>
            </div>
          </Card>

          {/* Operator decision 6 (2026-09-17), audit UXUI-02: this line added
              "ภายใต้มาตรฐาน ISO/IEC 17065", which no record in the repository
              supports, and it printed under every result, "not found" and "could
              not check" included. The issuer is named only for a certificate the
              register returned (constants/service-facts.ts CERTIFICATE_ISSUER_TH). */}
          {cert ? (
            <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
              {CERTIFICATE_ISSUER_TH}
            </p>
          ) : null}

          <div className="mt-3 text-center">
            <Button variant="ghost" href="/" leftSection={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}>
              กลับหน้าหลัก
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between border-b border-primary-100 py-2 last:border-0">
      <span className="mr-4 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}

/**
 * Issue and expiry dates are Bangkok days. This page renders on the server,
 * whose clock is UTC, so a certificate issued between 00:00 and 06:59 in
 * Bangkok showed the day before (UXUI-11, audit 2026-09-17).
 */
function formatDate(value: string) {
  return formatThaiDate(value, { day: '2-digit', month: 'long', year: 'numeric' });
}

/**
 * "17/9/2569 01:30:00" in Bangkok time, whatever the server clock's zone. An
 * unparseable backend time falls back to the page's own clock (still Bangkok)
 * instead of printing "Invalid Date".
 */
function formatCheckedAt(value: string | number | Date) {
  const at = new Date(value);
  const shown = Number.isNaN(at.getTime()) ? new Date() : at;
  return shown.toLocaleString('th-TH', { timeZone: THAI_TIME_ZONE });
}
