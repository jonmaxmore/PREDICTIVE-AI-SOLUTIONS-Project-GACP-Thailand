'use client';
import { SERVICE_NAME, SERVICE_NOUN, type RowService } from '@/lib/pricing/fee-services';


import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  FileText,
  Receipt,
  ClipboardList,
  ChevronRight,
  RefreshCcw,
} from 'lucide-react';
import { AuthService } from '@/lib/services/auth-service';
import { isCheckoutUiEnabled } from '@/lib/config/checkout-mode';
import {
  isQuotationAcceptable,
  isQuotationAcceptedForPayment,
  invoiceVatSplit,
  isQuotationLapsed,
  LEGACY_STATE_FEE_LABEL_TH,
  PaymentRecord,
  PaymentService,
  RECEIPT_ISSUED_LABEL_TH,
  receiptNumberRowLabelTH,
  quotationLapsedNoticeTh,
  type QuotationsBySide,
} from '@/lib/services/payment-service';
import { formatThaiDate } from '@/lib/format/thai-date';
import { NOT_CHARGED_TH, ONLINE_PAYMENT_STEP_TH } from '@/constants/service-facts';
import { Icons } from '@/components/ui/icons';
import { Button } from '@/components/ui/primitives/button';
import { SummaryHeader } from '@/components/feature';
import { PageSkeleton } from '@/components/ui/page-skeleton';
import { readPaymentsApplicationParam, resolvePaymentsApplicationId } from './payments-application-id';
import { checkoutEntryOwes, invoicedPhasesOf } from './checkout-entry-owes';
import { phaseDueState, PHASE_DUE_ORDER, type PhaseKey } from './phase-due-state';
import TwoCardPaymentSection from '@/components/payments/TwoCardPaymentSection';
import { HolderFilterChips, HolderLine, useHolderFilter } from '@/components/holder/holder-list';
import RefundVisibilitySection from '@/components/payments/RefundVisibilitySection';
import QuotationReviewSection from '@/components/payments/QuotationReviewSection';

type FilterType = 'ALL' | 'PENDING' | 'PAID';

/**
 * The surface of every notice that stands in for the pay button (F-G4-64 final
 * round R18 / finding C11).
 *
 * These blocks used `bg-mint-soft`, which tailwind.config.cjs defines as the
 * literal hex #f4f8f4 with no `.dark` counterpart, while `text-foreground`
 * flips to near-white in `.dark`. The health portal ships a theme toggle, so a
 * farmer in dark mode read white on white on the ONLY text that explains why
 * the online-payment button is not there. `bg-muted` is a token and flips with
 * the theme. One constant, because all five notices are the same surface and
 * the next one must not be able to differ.
 */
const QUOTATION_NOTICE_CLASS = 'rounded-[1.375rem] bg-muted px-4 py-3 text-sm text-foreground';

function formatCurrency(value: number) {
  // Defensive: Decimal money can arrive as a string from the API; coerce so
  // Intl.format never receives a string (NaN/garbage) and arithmetic upstream
  // never string-concatenates. The mapping in payment-service already coerces,
  // this is belt-and-suspenders for any other caller.
  const n = Number(value);
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);
}

function formatDate(value?: string) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('th-TH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// Status chip tone — friendly ui_kit: a soft-fill pill with a small leading
// colored dot (dot + word). `dot` is the dot color class; `tone` the
// fill/text. Tones map: amber=pending, sky=paid-pending-receipt,
// leaf=paid/receipt-issued, rose=overdue, slate=unknown.
function mapStatus(status: string) {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'PENDING') return { label: 'รอชำระเงิน', tone: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' };
  if (normalized === 'PAID_PENDING_RECEIPT') return { label: 'ชำระแล้ว รอออกใบเสร็จ', tone: 'bg-sky-50 text-sky-700', dot: 'bg-sky-500' };
  if (normalized === 'RECEIPT_ISSUED') return { label: RECEIPT_ISSUED_LABEL_TH, tone: 'bg-leaf-soft text-leaf-onSoft', dot: 'bg-leaf-600' };
  if (normalized === 'PAID') return { label: 'ชำระเงินแล้ว', tone: 'bg-leaf-soft text-leaf-onSoft', dot: 'bg-leaf-600' };
  if (normalized === 'OVERDUE') return { label: 'เกินกำหนดชำระ', tone: 'bg-rose-50 text-rose-700', dot: 'bg-rose-500' };
  // Voided invoice: neutral chip from the token set (muted flips with the
  // theme; the slate fallback below is legacy and not the pattern to copy).
  if (normalized === 'CANCELLED') return { label: 'ยกเลิกแล้ว', tone: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' };
  return { label: normalized || 'ไม่ทราบสถานะ', tone: 'bg-slate-100 text-foreground', dot: 'bg-slate-400' };
}

// round 5 (operator 2026-10-03): a renewal's one charge is named as the renewal
// service (the row's server `service`), never "งวดที่ 2".
function mapPhaseLabel(phase: PaymentRecord['phase'], service?: RowService | null) {
  if (service?.key === 'RENEWAL') return service.name;
  if (phase === 'PHASE_1') return 'งวดที่ 1';
  if (phase === 'PHASE_2') return 'งวดที่ 2';
  return 'ไม่ระบุงวด';
}

function mapComponentLabel(component: PaymentRecord['component'], service?: RowService | null) {
  // Fix round 1 (2026-09-26): a real legacy row, not "unspecified" — see
  // LEGACY_STATE_FEE_LABEL_TH.
  if (component === 'STATE') return LEGACY_STATE_FEE_LABEL_TH;
  if (component === 'PLATFORM') return 'ค่าบริการแพลตฟอร์ม';
  // The checkout invoice bills one catalogue service; its name comes from the server.
  // "ค่าบริการรับรอง" stood here — a name no catalogue holds (round 5 review).
  if (component === 'CHECKOUT') return service?.name ?? 'ค่าบริการ';
  return 'ไม่ระบุ';
}

export default function HealthPaymentsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // ?applicationId= or the older ?app= (see payments-application-id.ts).
  const appFilter = readPaymentsApplicationParam(searchParams);

  // Each read keeps only the latest request's answer.
  const paymentsRequestRef = useRef(0);
  const quotationsRequestRef = useRef(0);

  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [filter, setFilter] = useState<FilterType>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detailInvoice, setDetailInvoice] = useState<PaymentRecord | null>(null);
  // B1 — the invoice-PDF button used to be `onClick={() => void
  // PaymentService.downloadInvoicePdf(...)}`. downloadInvoicePdf catches its
  // own error and returns `false`, so discarding that boolean threw the only
  // signal away: while the backend 500'd (Prisma rejecting an `entityType`
  // select that does not exist on Entity), the farmer pressed the button and
  // NOTHING happened — no file, no message, no spinner. These two pieces of
  // state make both the in-flight and the failed press visible.
  // Which document of which invoice is being fetched: the invoice itself, or —
  // once paid and receipted — the receipt the system issued (P1).
  const [downloading, setDownloading] = useState<{ id: string; kind: 'INVOICE' | 'RECEIPT' } | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  // F-G4-64 — this page owns the quotation fetch and hands the result to
  // QuotationReviewSection as a prop, so the page and the card can never
  // disagree about the status and the endpoint is asked ONCE per visit (that
  // GET is also the door that re-issues a missing quotation, so calling it
  // twice would race two issuance attempts). `null` = not answered yet, which
  // is not the same as "no quotation": the pay entry stays silent until the
  // answer is in rather than flashing a refusal the page cannot yet justify.
  const [quotations, setQuotations] = useState<QuotationsBySide | null>(null);
  // Separate from the rows above because they are separate facts: the lookup
  // failing is not the register answering "none". Naming the second when the
  // first happened told the applicant the system was issuing their quotation on
  // the strength of a 500 (review r0 minor 6).
  const [quotationLookupFailed, setQuotationLookupFailed] = useState(false);

  useEffect(() => {
    const user = AuthService.getUser();
    if (!user) {
      router.push('/auth/health/login');
      return;
    }
    void loadPayments();
  }, [router]);

  // a11y — close detail-invoice modal on Escape (WCAG 2.1.2 No Keyboard Trap).
  useEffect(() => {
    if (!detailInvoice) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetailInvoice(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [detailInvoice]);

  // B1 — a download failure belongs to the invoice it happened on. Drop it
  // when the modal closes or switches invoices, so the next invoice never
  // opens already showing someone else's error.
  useEffect(() => {
    setDownloadError(null);
  }, [detailInvoice?.id]);

  async function loadPayments() {
    const ticket = ++paymentsRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const records = await PaymentService.getMyPayments();
      if (ticket !== paymentsRequestRef.current) return;
      setPayments(records);
    } catch {
      if (ticket !== paymentsRequestRef.current) return;
      // The rows are left exactly as they were. A failed read is a STATE, not an
      // answer, and it must never become the data — zeroing them here is what let
      // every money figure derived from this array report ฿0 for a list the page
      // could not read. Same shape as use-requirement-slots.ts.
      setError('ไม่สามารถโหลดข้อมูลการชำระเงินได้');
    } finally {
      if (ticket === paymentsRequestRef.current) setLoading(false);
    }
  }

  // Deep QA 2026-09-06 — a farmer with a PENDING quotation and zero invoices opened this
  // page from the nav menu and met "ไม่พบรายการชำระเงิน". Under the checkout rail no
  // invoice exists until the quotation is accepted HERE, so deriving the application from
  // invoice rows alone waits for a row only this page can cause. The applicant's own
  // application list is the third rung; the rule lives in payments-application-id.ts
  // where it is tested as a pure function.
  const [myApplications, setMyApplications] = useState<Array<{ id: string; status?: string | null; applicationNumber?: string | null; entityId?: string | null }>>([]);
  useEffect(() => {
    // Fetched even when ?app= names the application: the checkout entry's due-ness rule
    // reads this filing's STATUS from the same list, and the submit hand-over — the main
    // way farmers arrive here — always carries ?app=.
    let cancelled = false;
    void (async () => {
      // Through PaymentService — the boundary this page's tests already stub. Optional
      // call: an older stub without the method simply skips the third rung.
      const list = await PaymentService.getMyApplications?.().catch(() => []);
      if (!cancelled && Array.isArray(list)) setMyApplications(list);
    })();
    return () => { cancelled = true; };
  }, []);

  // Whom each invoice is for: the holder of its application (the invoice read does not
  // carry it). Display and filter only; nothing here touches an amount or a status.
  const holder = useHolderFilter();
  const holderSelectedId = holder.selectedId;
  const holderRowOf = useCallback(
    (item: { applicationId?: string | null }) => ({
      entityId: item.applicationId ? (myApplications.find((a) => a.id === item.applicationId)?.entityId ?? null) : null,
    }),
    [myApplications],
  );

  const shownPayments = useMemo(() => {
    return payments.filter((item) => {
      if (appFilter && item.applicationId !== appFilter) {
        return false;
      }
      if (holderSelectedId !== null && holderRowOf(item).entityId !== holderSelectedId) {
        return false;
      }
      if (filter === 'ALL') return true;
      if (filter === 'PAID') return !!item.isPaid;
      // รอชำระ: unpaid AND still owed. A cancelled invoice is not owed.
      return !item.isPaid && !item.isCancelled;
    });
  }, [appFilter, filter, payments, holderSelectedId, holderRowOf]);

  const grouped = useMemo(() => {
    const groups: { PHASE_1: PaymentRecord[]; PHASE_2: PaymentRecord[]; UNKNOWN: PaymentRecord[]; CANCELLED: PaymentRecord[]; [key: string]: PaymentRecord[] } = {
      PHASE_1: [],
      PHASE_2: [],
      UNKNOWN: [],
      CANCELLED: [],
    };
    for (const item of shownPayments) {
      // A cancelled invoice never reaches TwoCardPaymentSection: that path
      // picks the FIRST STATE/PLATFORM row per phase, so a voided duplicate
      // would shadow the live invoice and invite payment against a dead
      // document. It lists in its own bucket via the legacy table below,
      // with no pay action.
      if (item.isCancelled) {
        groups.CANCELLED.push(item);
        continue;
      }
      // SUBSCRIPTION (and any future/unrecognized phase) falls back to the
      // UNKNOWN bucket, which renders via the legacy single-payee table below.
      // Indexing groups[item.phase] directly returned undefined for
      // phase==='SUBSCRIPTION' and white-screened the whole page on .push().
      (groups[item.phase ?? 'UNKNOWN'] ?? groups.UNKNOWN).push(item);
    }
    return groups;
  }, [shownPayments]);

  const activeApplicationId = useMemo(
    () => resolvePaymentsApplicationId({ appFilter, payments, applications: myApplications }),
    [appFilter, payments, myApplications],
  );

  // The application whose quotation this page shows and gates on — the same
  // one QuotationReviewSection is mounted for below.
  const quotationApplicationId = appFilter || activeApplicationId;

  const loadQuotations = useCallback(async () => {
    if (!quotationApplicationId) {
      quotationsRequestRef.current += 1;
      setQuotations(null);
      setQuotationLookupFailed(false);
      return;
    }
    // getQuotations never throws. It answers `null` when the lookup itself
    // failed and an empty pair when the register holds none; both read as "not
    // accepted" here and therefore as "do not offer the pay button" —
    // fail-closed, matching the backend gate. Only the sentence differs.
    const ticket = ++quotationsRequestRef.current;
    const answer = await PaymentService.getQuotations(quotationApplicationId);
    if (ticket !== quotationsRequestRef.current) return;
    setQuotationLookupFailed(answer === null);
    setQuotations(answer ?? { dtam: null, platform: null });
  }, [quotationApplicationId]);

  useEffect(() => {
    void loadQuotations();
  }, [loadQuotations]);

  // P5 (staging walk 2026-09-29): the filter chip printed the application UUID.
  // The applicant knows the application NUMBER; both reads this page already
  // makes carry it — the applicant's own list, and the quotation lookup for the
  // same application. Never the UUID, even before either has answered.
  const filterApplicationNumber = useMemo(() => {
    if (!appFilter) return null;
    const fromList = myApplications.find((a) => a.id === appFilter)?.applicationNumber;
    if (fromList) return fromList;
    if (quotationApplicationId === appFilter && quotations?.applicationNumber) return quotations.applicationNumber;
    return null;
  }, [appFilter, myApplications, quotationApplicationId, quotations]);

  // F-G4-64 — the backend refuses to create a payment until every quotation the
  // application holds is accepted. Mirrored through the shared helper so this
  // page and the gate cannot drift apart.
  const quotationAccepted = isQuotationAcceptedForPayment(quotations);

  // Is there still an accept to be made? The card below draws its ยอมรับ button
  // on exactly this predicate, so pointing at that card is honest only while
  // this is true. An EXPIRED or REJECTED row has no button down there and the
  // card deliberately drops the same instruction (F-G4-55).
  const quotationAcceptable =
    isQuotationAcceptable(quotations?.dtam)
    || isQuotationAcceptable(quotations?.platform);
  const hasQuotationRow = Boolean(quotations?.dtam || quotations?.platform);
  // Final round R21 — a row still in an acceptable status whose validity date
  // has passed. The acceptance door refuses it (markQuotationAccepted,
  // QUOTATION_EXPIRED), so it is not "waiting for you"; and the remedy is one
  // this page performs itself on its own GET, not one staff can perform.
  const quotationLapsed =
    isQuotationLapsed(quotations?.dtam) || isQuotationLapsed(quotations?.platform);

  // What the applicant has to give staff so staff can find the document. The
  // application number is not on this screen and the id is a UUID; the document
  // numbers are what the register, the PDF and the card below all key on. Both
  // rows are named when a pre-W14 application still carries a pair, because the
  // refusal below is about the application, not about one of them.
  const quotationNumbers = [quotations?.dtam, quotations?.platform]
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => row.quotationNumber)
    .join(' และ ');

  // The "ยอดรอชำระ" / "ยอดที่ชำระแล้ว" KPI cards summarize the SAME application
  // scope as the table (appFilter) — but independent of the PAID/PENDING tab so
  // both cards always show the full breakdown. Previously these summed over ALL
  // of the applicant's payments regardless of appFilter, so viewing a single
  // application's invoices still showed the grand total across every application
  // the applicant had ever filed (the reported 160,5xx,xxx figure from
  // accumulated rows). Scoping by appFilter keeps the header and the table in
  // agreement on which application's money is being shown.
  const appScopedPayments = useMemo(
    () => (appFilter ? payments.filter((item) => item.applicationId === appFilter) : payments),
    [appFilter, payments],
  );

  // ยอดรอชำระ = unpaid AND not cancelled. A voided invoice is not owed.
  const pendingAmount = useMemo(
    () => appScopedPayments.filter((item) => !item.isPaid && !item.isCancelled).reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
    [appScopedPayments],
  );
  // Deep QA 2026-09-06 — an accepted quotation with an unbilled instalment IS debt, even
  // with zero invoice rows: under the checkout rail the invoice is minted by the checkout
  // this entry starts, so gating on invoice rows alone waited for a row only the button
  // could create. Rule + proof in checkout-entry-owes.ts.
  const activeQuotationRow = quotations?.platform || quotations?.dtam || null;
  const entryOwes = checkoutEntryOwes({
    pendingAmount,
    quotationAccepted,
    phase1InvoicedAt: (activeQuotationRow as { phase1InvoicedAt?: string | null } | null)?.phase1InvoicedAt ?? null,
    phase2InvoicedAt: (activeQuotationRow as { phase2InvoicedAt?: string | null } | null)?.phase2InvoicedAt ?? null,
    invoicedPhases: invoicedPhasesOf(payments, activeApplicationId),
    applicationStatus: myApplications.find((a) => a.id === activeApplicationId)?.status ?? null,
  });

  // Which instalment is collectable TODAY, and therefore which one the page leads with.
  //
  // operator, 2026-09-10: "งงมาก ไม่รู้จ่ายบิลไหนตอนไหน". งวดที่ 1 and งวดที่ 2 were drawn
  // as two equal cards in fixed numeric order, each with a total. On staging that is four
  // legacy invoices minted up front (28 still pending across 15 applications, measured
  // 2026-09-10), so a farmer past งวดที่ 1 had to scroll over a settled bill to reach the
  // live one, with nothing on either card saying which was which.
  //
  // The status comes from the SAME lookup the pay button gates on, so the chip and the
  // button can never disagree about what is payable. The rule itself is a pure function
  // (phase-due-state.ts), tested there.
  //
  // O3 (staging walk 2026-09-30): …and one section per APPLICATION × instalment. A company
  // workspace lists every application the company filed; grouping by phase alone put two
  // applications' invoices under one "งวดที่ 1" with a combined ยอดรวมงวด (฿11,770 for two
  // ฿5,885 bills) and no line saying which application either card was. Each section now
  // names its application and totals only that application's invoices, and its due state
  // is read from THAT application's status.
  const applicationNumberById = useMemo(() => {
    const byId = new Map<string, string>();
    for (const app of myApplications) {
      if (app.id && app.applicationNumber) byId.set(app.id, app.applicationNumber);
    }
    for (const row of payments) {
      if (row.applicationId && row.applicationNumber && !byId.has(row.applicationId)) {
        byId.set(row.applicationId, row.applicationNumber);
      }
    }
    return byId;
  }, [myApplications, payments]);

  const orderedPhases = useMemo(() => {
    // Applications in the order their invoices first appear; rows without one
    // (never expected for a phase invoice) keep a section of their own.
    const applicationOrder: Array<string | null> = [];
    for (const phaseKey of ['PHASE_1', 'PHASE_2'] as const) {
      for (const row of grouped[phaseKey] || []) {
        const appId = row.applicationId ?? null;
        if (!applicationOrder.includes(appId)) applicationOrder.push(appId);
      }
    }
    return applicationOrder
      .flatMap((appId) => (['PHASE_1', 'PHASE_2'] as const).map((phaseKey: PhaseKey) => {
        const rows = (grouped[phaseKey] || []).filter((row) => (row.applicationId ?? null) === appId);
        const status = appId ? (myApplications.find((a) => a.id === appId)?.status ?? null) : null;
        return {
          phaseKey,
          applicationId: appId,
          applicationNumber: appId ? (applicationNumberById.get(appId) ?? null) : null,
          rows,
          dueState: phaseDueState(phaseKey, status, rows, appId),
        };
      }))
      .filter((phase) => phase.rows.length > 0)
      // Payable first; ties keep the application order, and within an application
      // งวดที่ 1 above งวดที่ 2, which is the order the instalments are incurred in.
      .sort((a, b) => PHASE_DUE_ORDER[a.dueState] - PHASE_DUE_ORDER[b.dueState]);
  }, [grouped, myApplications, applicationNumberById]);

  const paidAmount = useMemo(
    () => appScopedPayments.filter((item) => item.isPaid).reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
    [appScopedPayments],
  );

  // B1 — surface a failed invoice download instead of swallowing it.
  // `downloadInvoicePdf` resolves false for every failure mode it knows
  // (non-2xx response, network error, blob error), so `false` is the signal.
  // The copy names the cause and the next action per
  // the thai-ui-copy guideline, and stays indeterminate: from the
  // browser we cannot tell a server fault from a dropped connection, so we
  // never assert the invoice itself is bad.
  async function handleDownloadInvoice(payment: PaymentRecord) {
    setDownloadError(null);
    setDownloading({ id: payment.id, kind: 'INVOICE' });
    try {
      const ok = await PaymentService.downloadInvoicePdf(payment.id, payment.documentNumber);
      if (!ok) {
        setDownloadError(
          'ดาวน์โหลดใบแจ้งหนี้ไม่สำเร็จ ระบบสร้างไฟล์ PDF ไม่ได้ในขณะนี้ กรุณาลองอีกครั้ง หากยังไม่สำเร็จ ติดต่อเจ้าหน้าที่การเงินพร้อมแจ้งเลขที่เอกสาร ' +
          payment.documentNumber,
        );
      }
    } catch {
      setDownloadError(
        'ดาวน์โหลดใบแจ้งหนี้ไม่สำเร็จ ระบบสร้างไฟล์ PDF ไม่ได้ในขณะนี้ กรุณาลองอีกครั้ง หากยังไม่สำเร็จ ติดต่อเจ้าหน้าที่การเงินพร้อมแจ้งเลขที่เอกสาร ' +
        payment.documentNumber,
      );
    } finally {
      setDownloading(null);
    }
  }

  // P1 — the receipt the system issued at settlement, for a paid invoice that
  // carries a receipt number. Same failure contract as the invoice download:
  // indeterminate cause, next action, and the number staff can look up.
  async function handleDownloadReceipt(payment: PaymentRecord) {
    if (!payment.receiptNumber) return;
    const receiptNumber = payment.receiptNumber;
    const failure =
      'ดาวน์โหลดใบเสร็จรับเงิน/ใบกำกับภาษีไม่สำเร็จ ระบบสร้างไฟล์ PDF ไม่ได้ในขณะนี้ กรุณาลองอีกครั้ง หากยังไม่สำเร็จ ติดต่อเจ้าหน้าที่การเงินพร้อมแจ้งเลขที่เอกสาร ' +
      receiptNumber;
    setDownloadError(null);
    setDownloading({ id: payment.id, kind: 'RECEIPT' });
    try {
      const ok = await PaymentService.downloadReceiptPdf(payment.id, receiptNumber);
      if (!ok) setDownloadError(failure);
    } catch {
      setDownloadError(failure);
    } finally {
      setDownloading(null);
    }
  }

  function statusMetaFor(payment: PaymentRecord) {
    return mapStatus(payment.erpStatus || payment.status);
  }

  return (
    // Wave E.2-B: adopt canonical SummaryHeader. DashboardLayout already
    // provides max-w-6xl + horizontal padding; the prior outer
    // `max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8` was duplicating that
    // (and overriding the layout's 1152px to 1200px — 48px wider —
    // making this page subtly different from siblings). Pending /paid
    // amounts are now KPI metrics inside the header card.
    <div className="space-y-6">
      <SummaryHeader
        eyebrow="ผู้ขอรับรอง · การเงิน"
        title="การชำระเงินและใบแจ้งหนี้"
        // Operator decision 6 (audit UXUI-X01): this said "ชำระค่าธรรมเนียม
        // ออนไลน์ผ่านระบบ" while the checkout screen could take no payment. It
        // can now when the backend holds a publishable key (PromptPay QR step,
        // 2026-09-27), and this page cannot see that, so the header stays a
        // list of what is here.
        description="ดูยอดค่าบริการ ใบเสนอราคา ใบแจ้งหนี้ และใบเสร็จของคำขอ"
        metrics={[
          // The list below already refuses to draw its empty state while `error` is
          // set; these two tiles are the same claim in numbers and must refuse too.
          // 'ยอดรอชำระ ฿0' on a failed read tells a farmer their debt is settled.
          { label: 'ยอดรอชำระ', value: loading || error ? '—' : formatCurrency(pendingAmount) },
          { label: 'ยอดที่ชำระแล้ว', value: loading || error ? '—' : formatCurrency(paidAmount) },
        ]}
        actions={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              // Both, because the quotation notice below tells the applicant
              // that this button re-checks the quotation, and GET
              // /applications/:id/quotations is what re-issues a missing one.
              void loadPayments();
              void loadQuotations();
            }}
            leftSection={<RefreshCcw className="h-4 w-4" aria-hidden="true" />}
          >
            รีเฟรช
          </Button>
        }
      />

      {/*
        W2-03 D2 — Stripe checkout entry. Renders exclusively behind
        isCheckoutUiEnabled() (NEXT_PUBLIC_CHECKOUT_UI_ENABLED === 'true',
        fail-closed): with the flag off this whole block is null. Pinned by
        __tests__/payments-checkout-entry-flag.test.tsx.

        F-G4-49 — the entry is a pay action, so it also needs something to
        pay: it renders only while the page's own ยอดรอชำระ (pendingAmount:
        unpaid, not cancelled, application-scoped) is above zero. A CERTIFIED
        application with every invoice settled used to keep showing
        "ชำระเงินออนไลน์" (now "สร้างรายการชำระเงิน") next to ฿0. With nothing
        owed, nothing renders here.
        Same key as the flag-off notice below. Pinned by
        __tests__/payments-checkout-entry-needs-debt.test.tsx.
      */}
      {/*
        UX-9 — flag OFF must fail LOUD. With the checkout UI disabled in
        this environment and money still owed, the page used to draw
        nothing where the pay button would be; the walk sat 60 s waiting
        for a control the product was never going to render. Name the
        cause and the next action instead. "Owed" is the page's own
        ยอดรอชำระ (pendingAmount), the KPI drawn right above: this block
        re-derives nothing about invoice status, so whatever that KPI
        counts as owed is what triggers the notice. Pinned by
        __tests__/payments-checkout-flag-off-notice.test.tsx.
      */}
      {/*
        Operator decision 6 (audit UXUI-05/UXUI-X01): the next action this
        notice named was to contact staff in order to pay, and no staff role
        can take a payment: the fee states are left only by the verified
        Stripe webhook (apps/backend/services/workflow-transition-service.js).
        What is true, and what the applicant needs to know, is that nothing was
        charged.
      */}
      {!isCheckoutUiEnabled() && !loading && pendingAmount > 0 ? (
        <div
          role="status"
          className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-700"
        >
          ระบบยังไม่เปิดช่องทางชำระเงินในสภาพแวดล้อมนี้ จึงยังชำระค่าบริการไม่ได้ {NOT_CHARGED_TH}
        </div>
      ) : null}

      {/*
        F-G4-64 — the entry is also gated on the quotation. createCheckout now
        refuses with QUOTATION_NOT_ACCEPTED / QUOTATION_NOT_ISSUED (409), so a
        button here would lead straight to a locked door. `quotations === null`
        means the answer has not arrived yet: nothing is claimed either way
        until it has.
      */}
      {isCheckoutUiEnabled() && !loading && activeApplicationId && entryOwes && quotations !== null ? (
        quotationAccepted ? (
          <div className="rounded-[1.375rem] bg-card p-4 shadow-leaf-card sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                {/*
                  Operator decision 6 (audit UXUI-X01): this block said the fee
                  could be paid online "ได้ทันที" under a "ชำระเงินออนไลน์"
                  button. Since the PromptPay QR step (2026-09-27) the screen
                  behind the button shows Stripe's QR when the backend holds a
                  publishable key, and says it cannot when it does not. This
                  page does not know which, so it states the sentence true in
                  both (ONLINE_PAYMENT_STEP_TH), and the button is still named
                  for what it does.
                */}
                <h3 className="text-sm font-bold text-primary">รายการชำระเงินของคำขอ</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {ONLINE_PAYMENT_STEP_TH}
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                href={`/health/payments/checkout?app=${encodeURIComponent(activeApplicationId)}`}
              >
                สร้างรายการชำระเงิน
              </Button>
            </div>
          </div>
        ) : quotationLookupFailed ? (
          // The lookup failed, so this page does not know what the register
          // holds. It may not say a document is being issued, and it may not
          // say one is waiting to be accepted; what it can say is that it could
          // not check, and which button asks again.
          <div
            role="status"
            data-testid="payments-quotation-notice"
            className={QUOTATION_NOTICE_CLASS}
          >
            ตรวจสอบใบเสนอราคาไม่สำเร็จ ระบบจึงยังไม่เปิดปุ่มสร้างรายการชำระเงิน
            กรุณากดปุ่มรีเฟรชด้านบนอีกครั้ง หากยังไม่สำเร็จ กรุณาติดต่อเจ้าหน้าที่
          </div>
        ) : quotationAcceptable ? (
          // A document exists and is still waiting for the applicant. Name the
          // cause and point at the card that unlocks it, which is on this same
          // page just below and really does draw the button.
          <div
            role="status"
            data-testid="payments-quotation-notice"
            className={QUOTATION_NOTICE_CLASS}
          >
            กรุณาตรวจสอบและยอมรับใบเสนอราคาก่อน จึงจะสร้างรายการชำระเงินได้ ดูการ์ดใบเสนอราคาด้านล่าง
          </div>
        ) : quotationLapsed ? (
          // Final round R21 — the offer window closed on a row nobody accepted.
          // The card below draws no button for it, and no staff surface can
          // issue a quotation (ledger F-G4-71); what really happens is that the
          // GET this page makes retires the lapsed row and issues a replacement
          // (services/quotation-issuance-on-submit.js), which the รีเฟรช button
          // above calls again. Name that, not a staff door.
          //
          // Fix round 1 (reviewer MINOR): that replacement is issued only for a
          // SINGLE live row — _lapsedOfferToReplace refuses a pre-W14 pair on
          // purpose — so an applicant holding a pair is told the fact and the
          // one door that exists, not a promise that would leave them
          // refreshing for ever.
          <div
            role="status"
            data-testid="payments-quotation-notice"
            className={QUOTATION_NOTICE_CLASS}
          >
            {quotationLapsedNoticeTh(quotations, 'payments-list')}
          </div>
        ) : hasQuotationRow ? (
          // A document exists but the accept step is over for it (หมดอายุ or
          // ปฏิเสธ). The card below offers no button, so this block must not
          // send anyone to look for one; the only party who can move this on is
          // staff. Review r2 minor 4: it does not promise a replacement
          // document either — no staff surface can void and re-issue a
          // quotation (no quotation route under routes/api/admin or
          // routes/api/provider) — so it names the party and the document
          // number staff need to act at all.
          <div
            role="status"
            data-testid="payments-quotation-notice"
            className={QUOTATION_NOTICE_CLASS}
          >
            ใบเสนอราคาของคำขอนี้ไม่สามารถกดยอมรับได้แล้ว
            กรุณาติดต่อเจ้าหน้าที่ พร้อมแจ้งเลขที่เอกสาร {quotationNumbers}
          </div>
        ) : (
          // No document at all. Telling the applicant to accept one would name
          // an action the product cannot deliver; the GET this page just made
          // is what re-issues it, and the รีเฟรช button above calls it again.
          <div
            role="status"
            data-testid="payments-quotation-notice"
            className={QUOTATION_NOTICE_CLASS}
          >
            ระบบกำลังออกใบเสนอราคาของคำขอนี้ กดปุ่มรีเฟรชด้านบนเพื่อตรวจสอบอีกครั้ง
            หากยังไม่ปรากฏหลังจากรอสักครู่ กรุณาติดต่อเจ้าหน้าที่
          </div>
        )
      ) : null}

      {/* ── Document Lifecycle ── */}
      <div className="rounded-[1.375rem] bg-card p-4 shadow-leaf-card sm:p-5">
        <h3 className="mb-3 text-sm font-bold text-primary">ขั้นตอนเอกสารการเงิน (Document Lifecycle)</h3>
        {/* Horizontal scroll on mobile keeps the row inside a 360px viewport.
            `-mx-4 px-4` extends the scrollable region to the card edges so the
            last item isn't clipped under the inner padding.

            THREE documents, not four (operator ruling 2026-09-05,
            docs/design/2026-09-05-finance-documents-design.md §2, which says
            "ไม่มีใบที่ 4" in those words):
              QT-PRD-   ใบเสนอราคา              — an offer, binding once accepted
              INV-PRD-  ใบวางบิล / ใบแจ้งหนี้    — ONE document with two names
              TAX-PRD-  ใบเสร็จรับเงิน / ใบกำกับภาษีเต็มรูป — proof of payment AND the tax
                        document; ป.รัษฎากร ม.86/4 binds this series alone
            This strip drew four by splitting the last one in half, so a farmer
            reading it waited for a paper that does not exist — and a wrong count
            of tax documents is a wrong statement about their evidence. */}
        <div className="no-scrollbar -mx-4 flex items-center overflow-x-auto px-4 sm:mx-0 sm:justify-between sm:overflow-visible sm:px-0">
          {[
            { label: 'ใบเสนอราคา', sublabel: 'Quotation', Icon: ClipboardList },
            { label: 'ใบวางบิล / ใบแจ้งหนี้', sublabel: 'Invoice', Icon: FileText },
            { label: 'ใบเสร็จรับเงิน / ใบกำกับภาษี', sublabel: 'Receipt / Tax Invoice', Icon: Receipt },
          ].map((doc, idx, arr) => (
            <div key={doc.sublabel} className="flex shrink-0 items-center">
              <div className="flex min-w-[88px] flex-col items-center rounded-2xl bg-mint-soft px-3 py-3 sm:px-4">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft">
                  <doc.Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <span className="mt-1.5 text-[11px] font-bold text-foreground">{doc.label}</span>
                <span className="text-[9px] text-muted-foreground">{doc.sublabel}</span>
              </div>
              {idx < arr.length - 1 && (
                <ChevronRight className="mx-1 h-5 w-5 text-primary-200 sm:mx-2" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          * เมื่อยื่นคำขอ คุณจะได้รับ<strong className="whitespace-nowrap">ใบเสนอราคา</strong>ก่อน → ยอมรับแล้วจึงได้รับ<strong className="whitespace-nowrap">ใบวางบิล / ใบแจ้งหนี้</strong>เพื่อชำระเงิน → หลังชำระจะออก<strong className="whitespace-nowrap">ใบเสร็จรับเงิน / ใบกำกับภาษี</strong>ให้อัตโนมัติในใบเดียวกัน
        </p>
      </div>

      {/*
        ใบเสนอราคา review/accept — sits above the invoice list so the farmer
        reviews and accepts the quotation BEFORE the Phase-1 payment cards.
        Self-hides when no quotation has been issued (application not yet
        SUBMITTED). Prefers the ?app= deep-link target (how the "review your
        quotation" CTA arrives) and falls back to the active application.

        NOT gated on this page's own `loading` (unlike the notices around
        it): `loading` flips back to `true` on EVERY `loadPayments()` call,
        including the refresh `onAccepted` fires right after a successful
        accept — gating the mount on it unmounted this section mid-refresh
        and remounted it once `loading` cleared, which can land BEFORE this
        page's own (separate, self-healing) `loadQuotations()` refetch has
        the ACCEPTED answer back. The remounted card then re-initialised its
        pill state from that stale PRE-accept prop and never updated
        (`useState` does not re-run on prop change), leaving the applicant's
        already-accepted quotation reading "รอการยอมรับ" until a full page
        reload (evidence/checkout-ux/). The section already renders its own
        skeleton while `quotations === null` (QuotationReviewSection.tsx),
        so no loading state is lost by not gating it here too.
      */}
      {quotationApplicationId ? (
        <QuotationReviewSection
          applicationId={quotationApplicationId}
          // F-G4-64 — the rows this page already fetched. Passing them keeps
          // the pay entry above and the card below reading the same answer,
          // and keeps the (re-issuing) GET to one call per visit.
          quotations={quotations}
          onAccepted={() => {
            void loadPayments();
            void loadQuotations();
          }}
        />
      ) : null}

      {/* ui_kit reskin (Wave 3): pill filter chips — leaf-fill active,
          white/soft idle — matching the ref applications/payments screens.
          Filter state + handler unchanged. */}
      <HolderFilterChips entities={holder.entities} selectedId={holder.selectedId} onSelect={holder.setSelectedId} />

      <div className="flex max-w-full flex-wrap gap-2">
        {[
          { value: 'ALL', label: 'ทั้งหมด' },
          { value: 'PENDING', label: 'รอชำระ' },
          { value: 'PAID', label: 'ชำระแล้ว' },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setFilter(option.value as FilterType)}
            className={`inline-flex min-h-[44px] items-center rounded-full px-4 text-sm font-semibold transition-colors ${
              filter === option.value
                ? 'bg-leaf text-white shadow-leaf-btn'
                : 'border border-primary-100 bg-card text-muted-foreground hover:bg-mint-soft'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {appFilter ? (
        <div className="rounded-2xl bg-sky-50 px-4 py-3 text-sm text-sky-700">
          {filterApplicationNumber ? (
            <>กรองตามคำขอ: <span className="font-mono">{filterApplicationNumber}</span></>
          ) : (
            'กรองตามคำขอที่เลือก'
          )}
        </div>
      ) : null}

      {/*
        Phase-1-paid / phase-2-not-yet-issued waiting state.
        Shown when filtering by ?app=<id>, where every existing invoice for
        the app is already paid and there is no pending invoice yet. Without
        this, the page renders an empty list and users wonder "where is the
        payment channel?" — fix from 2026-04-28 user feedback.
      */}
      {appFilter && !loading && !error && (() => {
        // Cancelled invoices are not part of "everything paid" nor of "phase 2
        // already issued": a voided duplicate must not hide or fake the banner.
        const appPayments = payments.filter((item) => item.applicationId === appFilter && !item.isCancelled);
        const allPaidForApp = appPayments.length > 0 && appPayments.every((item) => item.isPaid);
        const hasPhase2 = appPayments.some((item) => item.phase === 'PHASE_2');
        if (allPaidForApp && !hasPhase2) {
          return (
            <div className="rounded-2xl bg-leaf-soft px-4 py-3 text-sm text-leaf-onSoft">
              <strong>งวดที่ 1 ชำระเรียบร้อยแล้ว</strong>  เจ้าหน้าที่กำลังตรวจสอบเอกสารของคุณ
              เมื่อเอกสารผ่านการอนุมัติ ระบบจะออกใบแจ้งหนี้{SERVICE_NAME.PHASE_2}
              ให้อัตโนมัติ คุณจะได้รับการแจ้งเตือนในระบบ
            </div>
          );
        }
        return null;
      })()}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
          <button
            type="button"
            onClick={() => { void loadPayments(); }}
            className="ms-2 font-semibold underline underline-offset-2"
          >
            ลองใหม่
          </button>
        </div>
      ) : null}

      {/* A failed read must not render the empty state. Forcing GET /api/invoices/my
          to 500 on the live demo produced the error banner AND "ไม่พบรายการชำระเงิน"
          underneath it — a claim about the applicant's MONEY that the page cannot
          support. `error` is now part of the branch, so the only thing an unreadable
          list says is that it could not be read (evidence/apple-qa-audit-2026-09-07). */}
      {loading ? (
        <PageSkeleton type="list" />
      ) : error ? null : shownPayments.length === 0 ? (
        <div className="rounded-[1.375rem] bg-card p-8 text-center text-muted-foreground shadow-leaf-card">
          {filter === 'PENDING' && payments.length > 0
            ? 'ไม่มีรายการรอชำระในขณะนี้ ลองสลับไปแท็บ "ทั้งหมด" หรือ "ชำระแล้ว" เพื่อดูประวัติ'
            : 'ไม่พบรายการชำระเงิน'}
        </div>
      ) : (
        <div className="flow-stack-md">
          {/*
            One ค่าบริการ, one issuer (operator 2026-09-11): for PHASE_1 and
            PHASE_2 every invoice of the phase renders as its own full-width
            card, stacked vertically (TwoCardPaymentSection), one transfer to
            the company. UNKNOWN/SUBSCRIPTION rows still use the legacy
            table/card-stack rendering below since those flows only have a
            single payee.
          */}
          {orderedPhases.map(({ phaseKey, applicationId, applicationNumber, rows, dueState }) => {
            // W14: was 'โอน 2 ครั้ง (รัฐ + แพลตฟอร์ม)'. The farmer now makes ONE
            // transfer, to the company, which settles with the department itself.
            // round 5: the service is the rows' own (server `service`, renewal-aware);
            // without one, the instalment noun of the phase.
            const sectionService = rows.find((r) => r.service)?.service ?? null;
            const serviceNoun = sectionService
              ? sectionService.name.replace(/^งวดที่ \d+ /, '')
              : (phaseKey === 'PHASE_1' ? SERVICE_NOUN.PHASE_1 : SERVICE_NOUN.PHASE_2);
            const phaseDescription = `${serviceNoun} ชำระครั้งเดียวให้บริษัท`;

            return (
              <div key={`${applicationId ?? 'none'}-${phaseKey}`}>
              <HolderLine name={holder.holderOf(holderRowOf({ applicationId }))} />
              <TwoCardPaymentSection
                phaseLabel={mapPhaseLabel(phaseKey, sectionService)}
                phaseDescription={phaseDescription}
                dueState={dueState}
                applicationId={applicationId}
                applicationNumber={applicationNumber}
                invoices={rows}
                onViewDetail={setDetailInvoice}
              />
              </div>
            );
          })}

          {/* Legacy table/card-stack rendering for UNKNOWN/SUBSCRIPTION
              rows (no two-money-flow split applies) and for CANCELLED
              rows (listed for the record, no pay action). */}
          {(['UNKNOWN', 'CANCELLED'] as const).map((phaseKey) => {
            const rows = grouped[phaseKey] || [];
            if (rows.length === 0) return null;
            const sectionTitle = phaseKey === 'CANCELLED' ? 'ใบแจ้งหนี้ที่ยกเลิกแล้ว' : mapPhaseLabel(phaseKey);

            return (
              <section key={phaseKey} className="overflow-hidden rounded-[1.375rem] bg-card shadow-leaf-card">
                <header className="flex items-center justify-between px-5 py-4">
                  <h2 className="font-semibold text-foreground">{sectionTitle}</h2>
                  <span className="rounded-full bg-mint-soft px-3 py-1 text-xs font-medium text-muted-foreground">{rows.length} รายการ</span>
                </header>

                <div className="dense-data hidden lg:block">
                  <table className="min-w-full text-sm">
                    <thead className="bg-mint-bg text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 text-left text-[11.5px] font-semibold">เลขที่เอกสาร</th>
                        <th className="px-4 py-3 text-left text-[11.5px] font-semibold">ประเภท</th>
                        <th className="px-4 py-3 text-right text-[11.5px] font-semibold">จำนวนเงิน</th>
                        <th className="px-4 py-3 text-left text-[11.5px] font-semibold">สถานะ</th>
                        <th className="px-4 py-3 text-left text-[11.5px] font-semibold">วันที่ออกเอกสาร</th>
                        <th className="px-4 py-3 text-right text-[11.5px] font-semibold">การดำเนินการ</th>
                      </tr>
                    </thead>
                    <tbody className="bg-card">
                      {rows.map((payment) => {
                        const statusMeta = statusMetaFor(payment);
                        return (
                          <tr key={payment.id} className="border-t border-mint-bg">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft">
                                  <Receipt className="h-[18px] w-[18px]" aria-hidden="true" />
                                </span>
                                <span className="font-medium text-foreground">{payment.documentNumber}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <span className="rounded-full bg-mint-soft px-2.5 py-1 text-xs text-muted-foreground">{mapComponentLabel(payment.component, payment.service)}</span>
                            </td>
                            <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">{formatCurrency(payment.amount)}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${statusMeta.tone}`}>
                                <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusMeta.dot}`} />
                                {statusMeta.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 tabular-nums text-muted-foreground">{formatDate(payment.createdAt)}</td>
                            <td className="px-4 py-3 text-right">
                              {/* V1-B (D6): action buttons enforce
                                  `min-h-[44px]` (WCAG 2.5.5 / Android 44dp)
                                  on both rows so applicants using touch
                                  laptops or hybrid tablets get the same
                                  44px target as on mobile. */}
                              <div className="flex justify-end gap-2">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  className="min-h-[44px]"
                                  onClick={() => setDetailInvoice(payment)}
                                >
                                  ดูรายละเอียด
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-3 p-4 lg:hidden">
                  {rows.map((payment) => {
                    const statusMeta = statusMetaFor(payment);
                    return (
                      <article key={payment.id} className="rounded-2xl bg-mint-soft p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-leaf-soft text-leaf-onSoft">
                              <Receipt className="h-[18px] w-[18px]" aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground">{payment.documentNumber}</p>
                              <p className="text-xs text-muted-foreground">{mapPhaseLabel(payment.phase, payment.service)} · {mapComponentLabel(payment.component, payment.service)}</p>
                            </div>
                          </div>
                          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold ${statusMeta.tone}`}>
                            <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusMeta.dot}`} />
                            {statusMeta.label}
                          </span>
                        </div>
                        <div className="mt-3 text-sm text-foreground">
                          <p>จำนวนเงิน: <span className="font-semibold tabular-nums">{formatCurrency(payment.amount)}</span></p>
                          <p>วันที่ออกเอกสาร: <span className="tabular-nums">{formatDate(payment.createdAt)}</span></p>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="min-h-[44px] flex-1"
                            onClick={() => setDetailInvoice(payment)}
                          >
                            ดูรายละเอียด
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/*
        Iter 23 — applicant payment history + refund visibility.
        Sits below the active payment cards so the call-to-action
        (pay this invoice) stays at the top. Both sections fetch
        their own data via PaymentService; the refund section
        renders null when the applicant has zero credit notes.
      */}
      {!loading && activeApplicationId ? (
        <RefundVisibilitySection applicationId={activeApplicationId} />
      ) : null}

      {detailInvoice ? (
        // X6-B: W5-C `<button>` backdrop + `<div role="dialog">` split.
        // Mirrors X5-FIX-B H-9 pattern — closes both
        // jsx-a11y/click-events-have-key-events and
        // jsx-a11y/no-noninteractive-element-interactions warnings while
        // preserving click-outside-to-close behavior with a native button
        // that gets free Space/Enter activation.
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="ปิดหน้าต่างรายละเอียดใบแจ้งหนี้"
            className="absolute inset-0 cursor-default bg-slate-900/45"
            onClick={() => setDetailInvoice(null)}
          />
          {/* `max-h-[90vh] overflow-y-auto` keeps the fee breakdown
              accessible on short screens (360×640 etc.) — otherwise the
              footer Download button is clipped offscreen and the user
              has no way to close the modal. */}
          <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[1.375rem] bg-card p-5 shadow-2xl sm:p-6" role="dialog" aria-modal="true" aria-labelledby="invoice-detail-title">
            <div className="flex items-start justify-between">
                <h3 id="invoice-detail-title" className="text-lg font-semibold text-foreground">รายละเอียดใบแจ้งหนี้</h3>
              <button type="button" onClick={() => setDetailInvoice(null)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-mint-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf focus-visible:ring-offset-2" aria-label="ปิดหน้าต่างรายละเอียดใบแจ้งหนี้">
                <span aria-hidden="true"><Icons.X size={18} /></span>
              </button>
            </div>

            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">เลขที่เอกสาร</span><span className="font-medium text-foreground">{detailInvoice.documentNumber}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">งวด</span><span className="font-medium text-foreground">{mapPhaseLabel(detailInvoice.phase, detailInvoice.service)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">ประเภท</span><span className="font-medium text-foreground">{mapComponentLabel(detailInvoice.component, detailInvoice.service)}</span></div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground">สถานะ</span>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${statusMetaFor(detailInvoice).tone}`}>
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusMetaFor(detailInvoice).dot}`} />
                  {statusMetaFor(detailInvoice).label}
                </span>
              </div>
              {/* F-G4-53: once a receipt exists, the document the applicant
                  opened is also the receipt — name it and date it here, where
                  they come to read the document. Nothing shows before then.
                  The name comes from payment-service, the same call the phase
                  card makes, so the card and this modal cannot disagree; and
                  each row answers for its own column, so a number that arrived
                  without a date (or the reverse) still shows what is known. */}
              {detailInvoice.receiptNumber ? (
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">{receiptNumberRowLabelTH(detailInvoice)}</span><code className="font-mono text-foreground">{detailInvoice.receiptNumber}</code></div>
              ) : null}
              {detailInvoice.receiptIssuedAt ? (
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">วันที่ออกใบเสร็จ</span><span className="font-medium text-foreground">{formatThaiDate(detailInvoice.receiptIssuedAt)}</span></div>
              ) : null}
            </div>

            {/* Fee Breakdown (DOC-03) — itemized from API lineItems, fallback to computed */}
            <div className="mt-4 space-y-1.5 rounded-2xl bg-mint-soft p-3 text-sm">
              <p className="mb-2 font-semibold text-foreground">รายละเอียดค่าบริการ</p>
              {detailInvoice.lineItems && detailInvoice.lineItems.length > 0 ? (
                <>
                  {detailInvoice.lineItems.map((item, idx) => (
                    <div key={idx} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">
                        {item.description}
                        {item.quantity > 1 ? ` (×${item.quantity})` : ''}
                      </span>
                      <span className="whitespace-nowrap tabular-nums text-foreground">{formatCurrency(item.amount)}</span>
                    </div>
                  ))}
                  <div className="mt-1 flex justify-between border-t border-primary-100 pt-1.5 font-semibold"><span>รวมทั้งสิ้น</span><span className="tabular-nums text-leaf-onSoft">{formatCurrency(detailInvoice.amount)}</span></div>
                </>
              ) : detailInvoice.component === 'STATE' ? (
                // Fix round 1 (2026-09-26): a real legacy row — no VAT line
                // (VAT-exempt, ป.รัษฎากร ม.77/1(10)), no invented company
                // issuer. The total is exactly the stored amount.
                <div className="flex justify-between font-semibold"><span>รวมทั้งสิ้น</span><span className="tabular-nums text-leaf-onSoft">{formatCurrency(detailInvoice.amount)}</span></div>
              ) : (
                (() => {
                  // Round 5: the split is the invoice row's own (subtotal / vat),
                  // never `total / 1.07 * 0.07`. Without it, the total stands alone.
                  const total = detailInvoice.amount;
                  const split = invoiceVatSplit(detailInvoice);
                  return (
                    <>
                      {split ? (
                        <>
                          <div className="flex justify-between"><span className="text-muted-foreground">ค่าบริการ</span><span className="tabular-nums text-foreground">{formatCurrency(split.subtotal)}</span></div>
                          <div className="flex justify-between"><span className="text-muted-foreground">ภาษีมูลค่าเพิ่ม</span><span className="tabular-nums text-foreground">{formatCurrency(split.vat)}</span></div>
                        </>
                      ) : null}
                      <div className="mt-1 flex justify-between border-t border-primary-100 pt-1.5 font-semibold"><span>รวมทั้งสิ้น</span><span className="tabular-nums text-leaf-onSoft">{formatCurrency(total)}</span></div>
                    </>
                  );
                })()
              )}
            </div>

            {downloadError ? (
              <div
                role="alert"
                className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
              >
                {downloadError}
              </div>
            ) : null}

            {/* P1 (staging walk 2026-09-29): once paid and receipted, the
                document the applicant needs is the receipt the system issued,
                so it leads; the invoice stays downloadable, named as what it
                is. Unpaid: the invoice PDF, as before. */}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {detailInvoice.isPaid && detailInvoice.receiptNumber ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={downloading?.id === detailInvoice.id}
                    onClick={() => void handleDownloadInvoice(detailInvoice)}
                    leftSection={<Icons.Download size={16} />}
                  >
                    {downloading?.id === detailInvoice.id && downloading.kind === 'INVOICE' ? 'กำลังเตรียมไฟล์' : 'ดาวน์โหลดใบแจ้งหนี้'}
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={downloading?.id === detailInvoice.id}
                    onClick={() => void handleDownloadReceipt(detailInvoice)}
                    leftSection={<Icons.Download size={16} />}
                  >
                    {downloading?.id === detailInvoice.id && downloading.kind === 'RECEIPT' ? 'กำลังเตรียมไฟล์' : 'ดาวน์โหลดใบเสร็จรับเงิน/ใบกำกับภาษี'}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  disabled={downloading?.id === detailInvoice.id}
                  onClick={() => void handleDownloadInvoice(detailInvoice)}
                  leftSection={<Icons.Download size={16} />}
                >
                  {downloading?.id === detailInvoice.id ? 'กำลังเตรียมไฟล์' : 'ดาวน์โหลด PDF'}
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

