export const dynamic = 'force-dynamic';

import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck, ShieldAlert, ArrowLeft, Leaf, AlertTriangle, History, FileSearch } from 'lucide-react';
import { Card } from '@/components/ui/primitives/card';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { headers } from 'next/headers';
import { buildPublicVerifyUrl, toCertificateSlug } from '@/lib/verify/public-verify-url';
import { mapIntegrity } from '@/lib/verify/integrity-presentation';
import { formatRevisionDate } from '../../verify-view';
import { CERTIFICATE_ISSUER_TH } from '@/constants/service-facts';

export const metadata: Metadata = {
  title: 'ฉบับก่อนหน้าของใบรับรอง GACP | Certificate Revision',
  description: 'ตรวจสอบฉบับก่อนหน้าของใบรับรอง GACP สมุนไพร ที่ถูกแทนที่ด้วยฉบับแก้ไขแล้ว',
};

/**
 * The slice of `GET /api/v1/public/verify/:no/revisions/:n`
 * (apps/backend/routes/api/auth/public.js) this page renders. Always an
 * ARCHIVED revision (`superseded: true`); the live document is `/verify/:no`.
 * The snapshot carries only the public facts of the archived document; the
 * address line and the admin's free text stay in the archive.
 */
interface RevisionPayload {
  data?: {
    certificateNumber?: string;
    revisionNo?: number;
    superseded?: boolean;
    supersededAt?: string | null;
    integrity?: string | null;
    signatureValid?: boolean | null;
    snapshot?: {
      province?: string | null;
      district?: string | null;
      subDistrict?: string | null;
      farmName?: string | null;
    } | null;
  } | null;
}

/**
 * Three outcomes, not two: the revisions route answers 404 for "no such
 * archived revision" (unknown number, non-integer index, or nothing archived
 * at that index) and that IS a verdict here, unlike the verify page where every
 * definitive answer is a 200. Any other non-2xx or a thrown fetch is
 * infrastructure and must never render as "not found".
 */
type FetchOutcome =
  | { kind: 'ok'; payload: RevisionPayload | null }
  | { kind: 'notfound' }
  | { kind: 'unavailable' };

async function fetchRevision(certNumber: string, n: string): Promise<FetchOutcome> {
  // Same base-URL resolution as the verify page (`../../page.tsx`,
  // fetchCertificate): the INCOMING REQUEST host so nginx routes the fetch
  // to the SAME-environment backend, with buildPublicVerifyUrl adding the
  // `/api/v1` segment. See that function's comment for why an env var
  // cannot do this job.
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || 'https';
  if (!host) return { kind: 'unavailable' };
  const url = `${buildPublicVerifyUrl(`${proto}://${host}`, certNumber)}/revisions/${encodeURIComponent(n)}`;
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    if (res.ok) return { kind: 'ok', payload: await res.json() };
    if (res.status === 404) return { kind: 'notfound' };
    return { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

export default async function PublicCertRevisionPage({
  params,
}: {
  params: Promise<{ 'cert-number': string; n: string }>;
}) {
  const routeParams = await params;
  const certNumber = routeParams['cert-number'];
  const revisionParam = routeParams.n;
  const outcome = await fetchRevision(certNumber, revisionParam);
  const livePageHref = `/verify/${encodeURIComponent(toCertificateSlug(certNumber))}`;

  const data = outcome.kind === 'ok' ? outcome.payload?.data ?? null : null;
  const snapshot = data?.snapshot ?? null;
  const revisionNo = typeof data?.revisionNo === 'number' ? data.revisionNo : revisionParam;
  const supersededDate = formatRevisionDate(data?.supersededAt);
  const crypto = mapIntegrity(data?.integrity ?? undefined, data?.signatureValid ?? undefined);

  return (
    <div className="flex min-h-screen flex-col bg-mint-bg">
      {/* Marketing header — clean white lockup (same shell as the verify page) */}
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
          <div className="mb-6 text-center">
            <p className="text-xs font-bold uppercase text-leaf-800 dark:text-leaf-onSoft">ตรวจสอบใบรับรองสาธารณะ</p>
            <h1 className="mt-2 text-2xl font-bold leading-snug text-primary">ฉบับก่อนหน้าของใบรับรอง</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              ฉบับนี้ถูกแทนที่ด้วยฉบับแก้ไขแล้ว ข้อมูลด้านล่างคือข้อมูลตามที่บันทึกไว้ ณ วันที่ลงนามฉบับนี้
            </p>
          </div>

          <Card className="overflow-hidden">
            {/* Verdict strip for the ARCHIVED document. It never claims the
                document is in force: the strongest positive statement is
                "valid as issued, superseded on <date>". */}
            {outcome.kind === 'unavailable' ? (
              <div role="status" className="flex items-center gap-3 bg-amber-50 px-6 py-5">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
                  <AlertTriangle className="h-7 w-7" aria-hidden="true" />
                </span>
                <div className="leading-snug">
                  <p className="text-base font-bold text-amber-800">ไม่สามารถตรวจสอบได้ในขณะนี้</p>
                  <p className="text-xs text-amber-700">
                    ระบบตรวจสอบขัดข้องชั่วคราว ยังไม่สามารถยืนยันฉบับก่อนหน้าได้ กรุณาลองใหม่อีกครั้ง
                  </p>
                  <p className="text-xs text-amber-700">
                    Verification temporarily unavailable. No verdict was reached. Please try again.
                  </p>
                </div>
              </div>
            ) : outcome.kind === 'notfound' ? (
              <div role="status" className="flex items-center gap-3 bg-muted px-6 py-5 text-muted-foreground">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted-foreground/20">
                  <FileSearch className="h-7 w-7" aria-hidden="true" />
                </span>
                <div className="leading-snug">
                  <p className="text-base font-bold text-foreground">ไม่พบฉบับก่อนหน้าที่ระบุ</p>
                  <p className="text-xs">
                    ใบรับรองเลขที่นี้ไม่มีฉบับที่ {revisionParam} ในประวัติการแก้ไข หรือเลขที่ใบรับรองไม่ถูกต้อง
                    กรุณาตรวจสอบจากหน้าใบรับรองฉบับปัจจุบัน
                  </p>
                  <p className="text-xs">No such archived revision for this certificate number.</p>
                </div>
              </div>
            ) : crypto.tone === 'danger' ? (
              <div className="flex items-center gap-3 bg-red-50 px-6 py-5">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-500 text-white">
                  <ShieldAlert className="h-7 w-7" aria-hidden="true" />
                </span>
                <div className="leading-snug">
                  <p className="text-base font-bold text-red-700">{crypto.labelTH}</p>
                  <p className="text-xs text-red-700">{crypto.labelEN}</p>
                </div>
              </div>
            ) : crypto.tone === 'success' ? (
              <div className="flex items-center gap-3 bg-leaf-soft px-6 py-5">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-leaf text-white">
                  <History className="h-7 w-7" aria-hidden="true" />
                </span>
                <div className="leading-snug">
                  <p className="text-base font-bold text-leaf-700">
                    {supersededDate
                      ? `ฉบับนี้ถูกต้อง ณ วันที่ออก และถูกแทนที่แล้วเมื่อ ${supersededDate}`
                      : 'ฉบับนี้ถูกต้อง ณ วันที่ออก และถูกแทนที่แล้ว'}
                  </p>
                  <p className="text-xs text-leaf-700">
                    Valid as issued; superseded{supersededDate ? ` on ${supersededDate}` : ''}. Not the current document.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 bg-amber-50 px-6 py-5">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
                  <ShieldAlert className="h-7 w-7" aria-hidden="true" />
                </span>
                <div className="leading-snug">
                  <p className="text-base font-bold text-amber-800">{crypto.labelTH}</p>
                  <p className="text-xs text-amber-700">
                    {supersededDate
                      ? `ฉบับนี้ถูกแทนที่แล้วเมื่อ ${supersededDate} แต่ยังยืนยันลายเซ็นดิจิทัลของฉบับนี้ไม่ได้`
                      : 'ฉบับนี้ถูกแทนที่แล้ว แต่ยังยืนยันลายเซ็นดิจิทัลของฉบับนี้ไม่ได้'}
                  </p>
                  <p className="text-xs text-amber-700">{crypto.labelEN}</p>
                </div>
              </div>
            )}

            {/* Body — the archived snapshot */}
            <div className="flex flex-col gap-3 p-6">
              <div className="rounded-xl bg-mint-soft p-3 text-center font-mono text-lg font-bold text-leaf-onSoft">
                {data?.certificateNumber || certNumber}
              </div>

              {snapshot ? (
                <>
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-muted-foreground">ฉบับ</span>
                    <Badge tone="neutral">ฉบับที่ {revisionNo} (ถูกแทนที่แล้ว)</Badge>
                  </div>
                  {snapshot.farmName && <InfoRow label="ชื่อแปลง" value={snapshot.farmName} />}
                  {snapshot.province && <InfoRow label="จังหวัด" value={snapshot.province} />}
                  {snapshot.district && <InfoRow label="อำเภอ" value={snapshot.district} />}
                  {snapshot.subDistrict && <InfoRow label="ตำบล" value={snapshot.subDistrict} />}
                  <p className="pt-2 text-[11px] leading-relaxed text-muted-foreground">
                    ข้อมูลข้างต้นคือข้อมูลตามที่บันทึกไว้ในฉบับที่ {revisionNo} ณ วันที่ลงนาม ไม่ใช่ข้อมูลปัจจุบันของใบรับรอง
                  </p>
                </>
              ) : outcome.kind === 'unavailable' ? (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    ยังไม่สามารถแสดงข้อมูลฉบับก่อนหน้าได้ เนื่องจากระบบขัดข้องชั่วคราว
                  </p>
                  <Button
                    href={`${livePageHref}/revision/${encodeURIComponent(revisionParam)}`}
                    variant="outline"
                    className="border-amber-300 text-amber-700 hover:bg-amber-50"
                  >
                    ลองตรวจสอบอีกครั้ง
                  </Button>
                </div>
              ) : (
                <p className="py-4 text-center text-sm text-muted-foreground">ไม่มีข้อมูลฉบับก่อนหน้าให้แสดง</p>
              )}

              <Button variant="outline" href={livePageHref} className="mt-2 w-full">
                ดูใบรับรองฉบับปัจจุบัน
              </Button>
            </div>

            <div className="border-t border-primary-100 bg-mint-soft px-6 py-4 text-center">
              <p className="text-[11px] text-muted-foreground">ระบบรับรองมาตรฐาน GACP สมุนไพร | GACP Thai Platform</p>
            </div>
          </Card>

          {/* Same rule as the verify page (audit UXUI-02): no ISO/IEC 17065
              claim, and the issuer is named only for a revision the register
              returned. */}
          {data ? (
            <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
              {CERTIFICATE_ISSUER_TH}
            </p>
          ) : null}

          <div className="mt-3 text-center">
            <Button variant="ghost" href={livePageHref} leftSection={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}>
              กลับไปหน้าใบรับรอง
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
