'use client';


import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient } from '@/lib/api/api-client';
import { DEMO_MODE } from '@/lib/constants';
import { formatThaiDate } from '@/lib/format/thai-date';
import { Icons } from '@/components/ui/icons';
import { AREA_UNIT_LABEL } from '@/lib/area';
import { receiptNumberRowLabelTH } from '@/lib/services/payment-service';
import { submitAndHandOver } from '@/lib/services/submit-and-hand-over';
import { FEE_SERVICES_FALLBACK } from '@/lib/pricing/fee-services';
import {
  PAID_STATUSES,
  PURPOSE_LABELS,
  METHOD_LABELS,
  SERVICE_TYPE_LABELS,
  formatCurrency,
  formatDate,
  hasLiveLegacyPhase1Documents,
  invoiceStatusLabel,
  nextActionLabel,
  normalizePreviewDocuments,
  resolveLabel,
  statusTone,
  type PreviewApiResponse,
  type PreviewData,
} from './preview-page-config';

/**
 * What the checkout invoice's receipt number row is called.
 *
 * One document, one name: the checkout invoice is the company-issued combined
 * document (tax invoice that doubles as the receipt), and /health/payments
 * already names it through this helper. This page used to call the SAME number
 * 'เลขที่ใบเสร็จ', so an applicant comparing the two screens saw two names for
 * one document. Component 'CHECKOUT' is what payment.checkout.phase1 IS.
 */
const CHECKOUT_RECEIPT_ROW_LABEL = receiptNumberRowLabelTH({ component: 'CHECKOUT' });

/** One label/value line of the phase-1 payment section (F-G4-51). */
function PaymentFactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

export default function ApplicationPreviewPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const applicationId = searchParams.get('id');

  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!applicationId) {
      setError('ไม่พบรหัสคำขอ');
      setLoading(false);
      return;
    }

    const fetchPreview = async () => {
      setLoading(true);
      setError(null);

      const response = await apiClient.get<PreviewApiResponse>(`/preview/applications/${applicationId}/preview`);
      if (!response.success || !response.data?.success || !response.data.preview) {
        setError(response.error || response.data?.error || 'ไม่สามารถโหลดข้อมูลพรีวิวได้');
        setLoading(false);
        return;
      }

      setPreview(response.data.preview);
      setLoading(false);
    };

    void fetchPreview();
  }, [applicationId]);

  const healthInfo = preview?.health || preview?.applicant;
  const phase1Status = String(preview?.payment?.phase1Status || '').toUpperCase();
  // F-G4-51 — phase 1 under the one-invoice checkout rail. `checkout` is what
  // the applicant actually pays; the legacy per-side documents below are only
  // still rendered for applications that really carry live rows of that pair.
  const checkoutPhase1 = preview?.payment?.checkout?.phase1 ?? null;
  // B-F2: ONE phase-1 truth for the whole page. The footer chip used to read
  // only the split-rail settlement, so an applicant whose checkout invoice had
  // settled was told "ยังไม่ชำระงวดที่ 1" directly under a section saying
  // ชำระแล้ว.
  const isPhase1Paid = Boolean(preview?.payment?.breakdown?.phase1?.isPhasePaid)
    || Boolean(checkoutPhase1?.isPaid)
    || PAID_STATUSES.has(phase1Status);
  const statusUpper = String(preview?.status || '').toUpperCase();

  // Canonical: payment.phase1Amount/phase2Amount = full phase total (state + platform + VAT).
  // State-only is only available via payment.breakdown.phaseN.stateAmount.
  const phase1StateAmount = preview?.payment?.breakdown?.phase1?.stateAmount ?? 0;
  const phase1PlatformAmount = preview?.payment?.breakdown?.phase1?.platformAmount ?? 0;
  const phase1TotalAmount = preview?.payment?.breakdown?.phase1?.phaseTotal ?? preview?.payment?.phase1Amount ?? (phase1StateAmount + phase1PlatformAmount);
  const phase2StateAmount = preview?.payment?.breakdown?.phase2?.stateAmount ?? 0;
  const phase2PlatformAmount = preview?.payment?.breakdown?.phase2?.platformAmount ?? 0;
  const phase2TotalAmount = preview?.payment?.breakdown?.phase2?.phaseTotal ?? preview?.payment?.phase2Amount ?? (phase2StateAmount + phase2PlatformAmount);
  const stateTotal = preview?.payment?.breakdown?.totals?.stateTotal ?? (phase1StateAmount + phase2StateAmount);
  const platformTotal = preview?.payment?.breakdown?.totals?.platformTotal ?? (phase1PlatformAmount + phase2PlatformAmount);
  const grandTotal = preview?.payment?.breakdown?.totals?.grandTotal ?? (stateTotal + platformTotal);

  const legacyStateInvoiceStatus = preview?.financialDocuments?.phase1?.state?.invoice?.status;
  const legacyPlatformInvoiceStatus = preview?.financialDocuments?.phase1?.platform?.invoice?.status;
  // B-F3 + B2-1: the document of record is the rail the money MOVED on, not the
  // rail a row happens to exist on. The test used to be "a checkout row
  // exists", so an application settled on the split rail that also carried an
  // abandoned unpaid checkout invoice was shown the checkout section — printing
  // the number of an invoice nobody paid, and hiding the legacy invoice its
  // money really moved on. A cancelled ghost is still history either way.
  const hasLegacyPhase1Docs = !checkoutPhase1?.isPaid
    && hasLiveLegacyPhase1Documents(preview?.financialDocuments);
  const nextActionText = nextActionLabel(preview?.nextRequiredAction);

  const normalizedDocuments = useMemo(() => normalizePreviewDocuments(preview), [preview]);

  const selectionMethods = Array.isArray(preview?.selectionInfo?.cultivationMethods)
    ? preview?.selectionInfo?.cultivationMethods
    : [];

  // Wave E.1-D — status-aware submit + payment flow.
  //
  // Three paths the applicant might take from this preview page:
  //   - DRAFT / REGISTERED → submit (→ PENDING_DOC_FEE) + create phase-1
  //     invoice + redirect to /health/payments. (Original happy path.)
  //   - REVISION_REQUESTED → resubmit (→ ASSIGNED_FOR_REVIEW) + redirect
  //     to /health/applications/{id} (no payment needed; applicant
  //     already paid phase 1 in the original cycle).
  //   - CAR_PENDING → resubmit (→ CAR_REVIEWING) + redirect to detail
  //     page (already paid both phases; auditor reviews the CAR
  //     submission).
  //
  // Backend support for resubmit landed in Wave E.1-B
  // (apps/backend/routes/api/applications/applications.js submit handler).
  const isResubmit = statusUpper === 'REVISION_REQUESTED' || statusUpper === 'CAR_PENDING';
  const isInitialSubmit = statusUpper === 'REGISTERED' || statusUpper === 'DRAFT';

  // The one page the applicant is sent to after filing, named once: it is both
  // the success redirect and where a quotation-gate refusal points, so the two
  // cannot drift into different destinations.

  /**
   * Task 11 (2026-09-05) — this handler used to hold the whole file-and-hand-over rail
   * inline. Step 6 needs exactly the same rail, and a second copy of it would have drifted
   * apart from this one the first time the payment flow changed, so the logic moved to
   * `@/lib/services/submit-and-hand-over` and BOTH surfaces call it. Nothing about the
   * behaviour moved with it: the same submit door, the same Thai gate copy, the same
   * checkout-vs-legacy branch, the same destination.
   */
  async function handlePayment() {
    if (!applicationId) return;

    try {
      setPaymentLoading(true);
      setError(null);

      const outcome = await submitAndHandOver({ applicationId, isInitialSubmit, isResubmit });

      if (outcome.kind === 'REFUSED') {
        setError(outcome.message);
        return;
      }
      if (outcome.kind === 'REFUSED_BUT_FILED') {
        // The application IS filed; say why the next step stalled, and send them to the
        // tick that clears it.
        setError(outcome.message);
        router.push(outcome.href);
        return;
      }
      if (outcome.kind === 'FILED' && isInitialSubmit) {
        setPreview((prev) => (prev ? { ...prev, status: 'PENDING_DOC_FEE' } : prev));
      }
      router.push(outcome.href);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการสร้างรายการชำระเงิน';
      setError(message);
    } finally {
      setPaymentLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="rounded-2xl border border-border bg-card p-10 text-center text-muted-foreground">กำลังโหลดข้อมูลพรีวิว...</div>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">{error || 'ไม่พบข้อมูลพรีวิว'}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div id="official-preview-doc" className="surface-card overflow-hidden rounded-3xl">
        <header className="flex flex-col gap-4 bg-slate-50 px-6 py-5 md:flex-row md:items-start md:justify-between" data-print-hide="true">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">ตรวจสอบคำขอก่อนชำระเงินและยื่นทางการ</h1>
            <p className="mt-1 text-sm text-muted-foreground">แสดงข้อมูลจากระบบทั้งหมดแบบไม่ตัดฟิลด์ เพื่อใช้เป็นเอกสารราชการ</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center rounded-xl bg-card px-3 py-2 text-sm font-medium text-foreground shadow-[0_10px_24px_-22px_rgba(15,23,42,0.6)] hover:bg-slate-100"
            >
              <Icons.Printer size={14} className="mr-1" />
              พิมพ์เอกสาร
            </button>
            <button
              type="button"
              onClick={() => router.push('/health/applications/new')}
              className="inline-flex items-center rounded-xl bg-card px-3 py-2 text-sm font-medium text-foreground shadow-[0_10px_24px_-22px_rgba(15,23,42,0.6)] hover:bg-slate-100"
            >
              <Icons.Edit size={14} className="mr-1" />
              กลับไปแก้ไข
            </button>
          </div>
        </header>

        <main className="space-y-5 px-6 py-6">
          {preview.summary.isComplete ? (
            <div className="rounded-xl border border-leaf-300 bg-leaf-soft p-4 text-sm text-leaf-onSoft">
              ข้อมูลครบถ้วน พร้อมออกใบแจ้งหนี้งวดที่ 1
            </div>
          ) : (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              {preview.summary.missingFields.length > 0
                ? `ยังขาดข้อมูล: ${preview.summary.missingFields.join(', ')}`
                : 'กรุณากรอกข้อมูลที่จำเป็นให้ครบก่อนชำระเงิน'}
            </div>
          )}

          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
          ) : null}

          <section className="rounded-2xl bg-slate-50 p-4 sm:p-5">
            <h2 className="text-base font-semibold text-foreground">ข้อมูลผู้ยื่นคำขอ</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
              <div>
                <p className="text-muted-foreground">ชื่อ-นามสกุล</p>
                <p className="font-medium text-foreground">{healthInfo?.name || '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">โทรศัพท์</p>
                <p className="font-medium text-foreground">{healthInfo?.phone || '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">อีเมล</p>
                <p className="font-medium text-foreground">{healthInfo?.email || '-'}</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-slate-50 p-4 sm:p-5">
            <h2 className="text-base font-semibold text-foreground">ข้อมูลจากขั้นตอนที่ 1</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
              <div>
                <p className="text-muted-foreground">พืชที่ขอรับรอง</p>
                <p className="font-medium text-foreground">{preview.selectionInfo?.plantId || preview.farmInfo?.plantType || '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">ประเภทบริการ</p>
                <p className="font-medium text-foreground">{resolveLabel(preview.selectionInfo?.serviceType, SERVICE_TYPE_LABELS)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">วัตถุประสงค์</p>
                <p className="font-medium text-foreground">{resolveLabel(preview.selectionInfo?.purpose, PURPOSE_LABELS)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">รูปแบบการปลูก</p>
                <p className="font-medium text-foreground">
                  {selectionMethods.length > 0
                    ? selectionMethods.map((method) => resolveLabel(method, METHOD_LABELS)).join(', ')
                    : '-'}
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-slate-50 p-4 sm:p-5">
            <h2 className="text-base font-semibold text-foreground">ข้อมูลฟาร์มและพื้นที่</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
              <div>
                <p className="text-muted-foreground">ชื่อฟาร์ม</p>
                <p className="font-medium text-foreground">{preview.farmInfo?.farmName || '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">มาตรฐาน</p>
                <p className="font-medium text-foreground">{preview.farmInfo?.standardCode || 'GACP'}</p>
              </div>
              {/* F-G4-50: the farm section used to repeat "รูปแบบการปลูก" from
                  farmInfo.areaType — the single Application.areaType enum
                  derived from the FIRST cultivation method, printed raw
                  ("OUTDOOR") on an application that selected three. The step-1
                  section above prints the full list through METHOD_LABELS;
                  one fact, one place. areaType stays in the API for other
                  consumers. */}
              <div>
                <p className="text-muted-foreground">ขนาดพื้นที่</p>
                <p className="font-medium text-foreground">{preview.farmInfo?.areaSize || '-'} {AREA_UNIT_LABEL}</p>
              </div>
              <div>
                <p className="text-muted-foreground">ชนิดพืช</p>
                <p className="font-medium text-foreground">{preview.farmInfo?.plantType || '-'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">ที่ตั้ง</p>
                <p className="font-medium text-foreground">{preview.farmInfo?.location || '-'}</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-slate-50 p-4 sm:p-5">
            <h2 className="text-base font-semibold text-foreground">ข้อมูลการผลิต</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
              <div>
                <p className="text-muted-foreground">วันเริ่มปลูก</p>
                <p className="font-medium text-foreground">{formatDate(preview.productionInfo?.plantingDate)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">วันคาดเก็บเกี่ยว</p>
                <p className="font-medium text-foreground">{formatDate(preview.productionInfo?.harvestDate)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">ผลผลิตคาดการณ์</p>
                <p className="font-medium text-foreground">{preview.productionInfo?.estimatedYield ? `${preview.productionInfo.estimatedYield} kg` : '-'}</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-slate-50 p-4 sm:p-5">
            <h2 className="text-base font-semibold text-foreground">เอกสารแนบ</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-2 py-2">เอกสาร</th>
                    <th className="px-2 py-2">สถานะ</th>
                    <th className="px-2 py-2" data-print-hide="true">เปิดดู</th>
                  </tr>
                </thead>
                <tbody>
                  {normalizedDocuments.length > 0 ? normalizedDocuments.map((doc, index) => (
                    <tr key={`${doc.type || doc.name || 'doc'}-${index}`} className="border-b border-slate-100">
                      <td className="px-2 py-2 text-foreground">{doc.name || doc.type || `เอกสาร ${index + 1}`}</td>
                      <td className="px-2 py-2">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs ${doc.uploaded ? 'border-leaf-300 bg-leaf-soft text-leaf-onSoft' : 'border-border bg-slate-50 text-muted-foreground'}`}>
                          {doc.uploaded ? 'อัปโหลดแล้ว' : 'ยังไม่พบไฟล์'}
                        </span>
                      </td>
                      <td className="px-2 py-2" data-print-hide="true">
                        <button
                          type="button"
                          disabled={!doc.url && !doc.fileUrl}
                          onClick={() => {
                            const targetUrl = doc.url || doc.fileUrl;
                            if (!targetUrl) return;
                            window.open(targetUrl, '_blank', 'noopener,noreferrer');
                          }}
                          className="rounded-lg border border-border px-3 py-1 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          เปิด
                        </button>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={3} className="px-2 py-3 text-muted-foreground">ไม่พบรายการเอกสาร</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl bg-slate-50 p-4 sm:p-5">
            <h2 className="text-base font-semibold text-foreground">สรุปค่าบริการ</h2>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">จำนวนรูปแบบการปลูก</span><span className="font-medium text-foreground">{preview.payment.scopeCount || 1}</span></div>
              {/* fix/fee-line-descriptions round 2 (operator 2026-10-03): one service fee,
                  never split into a state part and a platform part. Each instalment is named
                  by the catalogue; the figures are the same totals this block always printed. */}
              {/* round 4: a renewal is one charge — no instalment 1, named as the renewal. */}
              {preview.payment.isRenewal ? null : (
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">{FEE_SERVICES_FALLBACK.PHASE_1.name}</span><span className="font-medium text-foreground">{formatCurrency(phase1TotalAmount)}</span></div>
              )}
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">{preview.payment.isRenewal ? FEE_SERVICES_FALLBACK.RENEWAL.name : FEE_SERVICES_FALLBACK.PHASE_2.name}</span><span className="font-medium text-foreground">{formatCurrency(phase2TotalAmount)}</span></div>
              <div className="pt-2" />
              <div className="flex justify-between"><span className="text-base font-semibold text-foreground">ยอดรวมทั้งสิ้น</span><span className="text-base font-semibold text-foreground">{formatCurrency(grandTotal)}</span></div>
            </div>
          </section>

          {/* F-G4-51: the per-side PHASE_1 quote/invoice pair is retired under
              the one-invoice checkout rail (F-G4-35), so for every application
              minted on that rail the four slots below stay empty forever. An
              application that really HAS those legacy rows still shows them;
              everyone else sees the phase-1 payment state of the checkout
              invoice they actually pay. */}
          {hasLegacyPhase1Docs ? (
            <section className="rounded-2xl bg-slate-50 p-4 sm:p-5">
              <h2 className="text-base font-semibold text-foreground">เอกสารการเงินงวดที่ 1</h2>
              <div className="mt-3 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
                <div className="rounded-lg border border-border p-3">
                  <p className="text-muted-foreground">ใบเสนอราคา (ภาครัฐ)</p>
                  <p className="font-medium text-foreground">{preview.financialDocuments?.phase1?.state?.quote?.quoteNumber || preview.financialDocuments?.quote?.quoteNumber || '-'}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-muted-foreground">ใบแจ้งหนี้ (ภาครัฐ)</p>
                  <p className="font-medium text-foreground">{preview.financialDocuments?.phase1?.state?.invoice?.invoiceNumber || preview.financialDocuments?.invoice?.invoiceNumber || '-'}</p>
                  {/* B-F4: the pill printed the stored English status
                      ('PENDING') at the applicant; a status with no Thai
                      wording renders no pill at all. */}
                  {invoiceStatusLabel(legacyStateInvoiceStatus) ? (
                    <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-xs ${statusTone(legacyStateInvoiceStatus)}`}>
                      {invoiceStatusLabel(legacyStateInvoiceStatus)}
                    </span>
                  ) : null}
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-muted-foreground">ใบเสนอราคา (แพลตฟอร์ม)</p>
                  <p className="font-medium text-foreground">{preview.financialDocuments?.phase1?.platform?.quote?.quoteNumber || '-'}</p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-muted-foreground">ใบแจ้งหนี้ (แพลตฟอร์ม)</p>
                  <p className="font-medium text-foreground">{preview.financialDocuments?.phase1?.platform?.invoice?.invoiceNumber || '-'}</p>
                  {invoiceStatusLabel(legacyPlatformInvoiceStatus) ? (
                    <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-xs ${statusTone(legacyPlatformInvoiceStatus)}`}>
                      {invoiceStatusLabel(legacyPlatformInvoiceStatus)}
                    </span>
                  ) : null}
                </div>
              </div>
            </section>
          ) : (
            <section className="rounded-2xl bg-muted p-4 sm:p-5">
              <h2 className="text-base font-semibold text-foreground">การชำระเงินงวดที่ 1</h2>
              {isPhase1Paid ? (
                <div className="mt-3 space-y-2 text-sm">
                  <span className="inline-flex rounded-full border border-leaf-300 bg-leaf-soft px-2.5 py-1 text-xs font-medium text-leaf-onSoft">
                    ชำระแล้ว
                  </span>
                  {/* B2-1: these facts describe the CHECKOUT invoice, so they
                      belong to the applicant only when that invoice is the one
                      that was paid. A phase settled on the split rail says
                      ชำระแล้ว and stops: quoting the number of an unpaid
                      checkout row under it would name the wrong document. */}
                  {checkoutPhase1?.isPaid ? (
                    <>
                      {checkoutPhase1.invoiceNumber ? (
                        <PaymentFactRow label="เลขที่ใบแจ้งหนี้" value={checkoutPhase1.invoiceNumber} />
                      ) : null}
                      {checkoutPhase1.receiptNumber ? (
                        <PaymentFactRow label={CHECKOUT_RECEIPT_ROW_LABEL} value={checkoutPhase1.receiptNumber} />
                      ) : null}
                      {checkoutPhase1.receiptIssuedAt ? (
                        <PaymentFactRow label="วันที่ออกใบเสร็จ" value={formatThaiDate(checkoutPhase1.receiptIssuedAt)} />
                      ) : null}
                      {typeof checkoutPhase1.totalAmount === 'number' ? (
                        <PaymentFactRow label="ยอดชำระ" value={formatCurrency(checkoutPhase1.totalAmount)} />
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : (
                <div className="mt-3 space-y-2 text-sm">
                  <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                    ยังไม่ชำระ
                  </span>
                  <p className="text-muted-foreground">
                    ชำระได้ที่หน้าชำระเงินหลังยื่นคำขอ ระบบจะออกใบเสร็จให้คุณอัตโนมัติหลังชำระเงิน
                  </p>
                </div>
              )}
            </section>
          )}



        </main>

        <footer className="flex flex-col gap-3 bg-slate-50 px-6 py-4" data-print-hide="true">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${isPhase1Paid ? 'border-leaf-300 bg-leaf-soft text-leaf-onSoft' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
              {/* F-G4-51: the unpaid half printed the raw phase1Status enum
                  ("สถานะงวดที่ 1: PENDING") at the applicant. */}
              {isPhase1Paid ? 'ชำระงวดที่ 1 แล้ว' : 'ยังไม่ชำระงวดที่ 1'}
            </span>
            {/* B-F2: the chip printed the raw action enum
                ("ขั้นตอนถัดไป: PAY_PHASE_1"). An action with no Thai wording
                shows no chip: a key the applicant cannot read is not a next
                step. */}
            {nextActionText ? (
              <span className="inline-flex rounded-full border border-border bg-slate-50 px-2.5 py-1 text-xs text-foreground">
                ขั้นตอนถัดไป: {nextActionText}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => router.push('/health/applications')}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-slate-50"
            >
              กลับไปรายการคำขอ
            </button>
            {/* Wave E.1-D — hide phase-1 invoice link for resubmit paths
                (applicant already paid in the original cycle). */}
            {!isResubmit && (
              <button
                type="button"
                onClick={() => router.push(`/health/payments?app=${applicationId}&phase=1`)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-slate-50"
              >
                เปิดรายการใบแจ้งหนี้งวดที่ 1
              </button>
            )}
            <button
              type="button"
              onClick={() => void handlePayment()}
              disabled={
                // Don't gate resubmit on isPhase1Paid — they already paid; that's the point.
                // Don't gate resubmit on the completeness heuristic either:
                // summary.isComplete (summarizeCompletion) diverges from the
                // REAL gate /submit enforces (validateSubmissionPayload) — for
                // resubmit states the heuristic can read false while /submit
                // would pass, silently re-closing the door this page exists to
                // reopen (final-review round, Item 2). /submit's own 422 is
                // the judge for resubmit; its message surfaces via `error`
                // above.
                (!DEMO_MODE && !isResubmit && !preview.summary.isComplete) ||
                paymentLoading ||
                (!isResubmit && isPhase1Paid)
              }
              className="rounded-lg bg-leaf-700 px-4 py-2 text-sm font-semibold text-white hover:bg-leaf-800 disabled:cursor-not-allowed disabled:bg-leaf-300"
            >
              {/* Wave E.1-D — button label state-aware:
                  - DRAFT/REGISTERED → "ยื่นคำขอแล้วไปหน้าชำระเงินงวดที่ 1 / 1,500 บาท"
                  - REVISION_REQUESTED → "ส่งคำขอแก้ไข — รอผู้ตรวจเอกสารพิจารณา"
                  - CAR_PENDING → "ส่ง CAR — รอผู้ตรวจสถานที่พิจารณา"
                  - paid initial → "ชำระงวดที่ 1 แล้ว" */}
              {paymentLoading
                ? (isResubmit ? 'กำลังส่งคำขอแก้ไข...' : 'กำลังเตรียมรายการชำระเงิน...')
                : statusUpper === 'REVISION_REQUESTED'
                  ? 'ส่งคำขอแก้ไข รอผู้ตรวจเอกสารพิจารณา'
                  : statusUpper === 'CAR_PENDING'
                    ? 'ส่ง CAR รอผู้ตรวจสถานที่พิจารณา'
                    : isPhase1Paid
                      ? 'ชำระงวดที่ 1 แล้ว'
                      : `ยื่นคำขอแล้วไปหน้าชำระเงินงวดที่ 1 / ${formatCurrency(phase1TotalAmount)}`}
            </button>
          </div>
        </footer>
      </div>

      <style jsx global>{`
        @media print {
          [data-print-hide='true'] {
            display: none !important;
          }
          #official-preview-doc {
            box-shadow: none !important;
            border: 1px solid #94a3b8 !important;
          }
        }
      `}</style>
    </div >
  );
}


