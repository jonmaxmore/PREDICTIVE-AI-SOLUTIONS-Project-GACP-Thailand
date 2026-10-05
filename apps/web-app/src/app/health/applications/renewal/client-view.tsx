"use client";

export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { apiClient as api } from '@/lib/api';
import { Spinner } from '@/components/ui/spinner';
import { HEALTH_LOGIN_ROUTE } from '@/lib/constants/auth-routes';
import { getStoredUser } from '@/lib/services/auth-service-session';
import { th } from '@/lib/i18n/dictionaries/th';
import { useLanguage } from '@/lib/i18n/language-context';
import { resolveErrorCode } from '@/lib/i18n/error-code-map';
import { Certificate, RenewalStep } from './types';
import { QuotationStep } from './quotation-step';
import { InvoiceStep } from './invoice-step';
import { PaymentStep } from './payment-step';
// V1 review M-3: SuccessStep removed — D3 disabled the success-step jump
// since the backend renewal-payment endpoint doesn't exist. Re-enable this
// import + the `case 'success'` branch only when RENEWAL_PAYMENT_WIRED flips
// true (which requires the missing backend, future iter).

// V1-C / D3 — RENEWAL_PAYMENT_WIRED feature flag.
//
// Previous code (before V1-C) POSTed to `/api/payments/confirm` and on
// failure (which is the always-case — the endpoint does NOT exist on the
// backend; grep apps/backend/routes/api/finance/ returns zero matches
// for `payments/confirm`) silently jumped to the success step. The
// try/catch swallowed the 404, leaving applicants believing they had
// paid for renewal when no invoice / payment transaction had
// been created. REAL MONEY LOSS RISK on first renewal cycle.
//
// Option A (wire renewal to the Stripe checkout flow at
// /health/payments/checkout) requires renewal-service to expose a
// "create renewal invoice" function returning a real invoice id. The current service
// (apps/backend/services/renewal-service.js, exports
// createRenewalApplication / getApplicationsForRenewalReminder /
// markRenewalReminderSent / supersedeCertificate / listUpcomingExpiry)
// only creates a DRAFT Application — invoice creation is downstream in
// the normal phase-1 flow and not callable from a single client-side
// action. So Option A is NOT feasible in this iteration.
//
// Option B (defensive) chosen: gate the success-step jump behind a
// feature flag (default false) and replace the fake POST with a Thai
// info message instructing the applicant to contact DTAM. The renewal
// DRAFT application is still created at the quotation step, so the
// applicant's progress is not lost; only the fake "you paid" jump is
// removed. When backend wiring is delivered in a future iteration,
// flip the flag and (preferably) replace the inline message with a
// redirect to the Stripe checkout page (/health/payments/checkout).
const RENEWAL_PAYMENT_WIRED = false;

function RenewalLoadingFallback() {
    return (
        <div className="bg-surface-100 flex min-h-screen items-center justify-center">
            <Spinner size="xl" />
        </div>
    );
}

/**
 * X1-FIX-C / C-3 (partial) — Renewal payment advisory banner.
 *
 * X1-A flagged that the existing payment-step inline notice
 * (`paymentPendingMessage`, only shown AFTER the user clicked "confirm
 * payment") was too late: the applicant had already filled in upload,
 * quotation, and invoice screens before discovering that the system
 * cannot actually take their renewal payment. Per the audit's CRIT-3
 * remediation: surface a prominent warning at the TOP of the renewal
 * entry page that is visible on EVERY step of the wizard.
 *
 * The backend wiring (Option A in client-view.tsx top-of-file comment)
 * remains OUT OF SCOPE — `RENEWAL_PAYMENT_WIRED` stays false, the
 * existing payment-step notice stays in place. This banner is purely
 * informational and sets expectations before the applicant invests
 * time uploading documents.
 *
 * i18n: pulls Thai/English from `dict.renewalAdvisory` so the banner
 * localizes even though the rest of this file is still Thai-only (the
 * full renewal-flow i18n work is deferred to a later X1 iteration per
 * the M-1 deferral list in X1-A §7).
 */
function RenewalAdvisoryBanner({ supportEmail, dictBanner }: {
    supportEmail: string;
    dictBanner: { title: string; body: string; contactCta: string; contactFormCta: string };
}) {
    return (
        <div
            role="alert"
            data-testid="renewal-advisory-banner"
            className="mb-6 w-full rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 shadow-sm"
        >
            <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                    <AlertTriangle className="h-5 w-5" aria-hidden="true" focusable="false" />
                </div>
                <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-bold leading-snug text-amber-900 sm:text-base">
                        {dictBanner.title}
                    </h2>
                    <p className="mt-1 text-sm leading-relaxed text-amber-800">{dictBanner.body}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <a
                            href={`mailto:${supportEmail}`}
                            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-amber-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2"
                        >
                            {dictBanner.contactCta}
                        </a>
                        <Link
                            href="/help/contact"
                            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-amber-300 bg-white px-4 text-sm font-semibold text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2"
                        >
                            {dictBanner.contactFormCta}
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}

function RenewalContent() {
    const _router = useRouter();
    const searchParams = useSearchParams();
    const certId = searchParams.get('certId');
    const { dict } = useLanguage();
    // X1-FIX-C / C-3 — pull banner copy from the dict so EN users see the
    // English variant even while the rest of this flow is still Thai-only
    // (the broader renewal-flow i18n is deferred to a later X1 iteration
    // per the I-017 enumeration). Falls back to the Thai literals so the
    // page still works if a key goes missing during a rename.
    // Falls back to the Thai dictionary itself, not to a second copy of its
    // words: the fallback used to restate the body ("กรุณาติดต่อ DTAM", then a
    // verbatim copy of th-core), and a copy drifts.
    const advisory = dict.renewalAdvisory || th.renewalAdvisory;
    // Y1-FIX-B — pull renewal flow copy from dict.health.renewal
    const renewalCopy = dict.health.renewal;

    const [isDark, setIsDark] = useState(false);
    const [certificate, setCertificate] = useState<Certificate | null>(null);
    const [loading, setLoading] = useState(true);
    // W1-RETRY — certificate load failure. Previously a failed
    // GET /api/certificates/:id (backend down → 503 BACKEND_UNREACHABLE)
    // was SILENT: certificate stayed null and the applicant landed on the
    // upload wizard with no cert card, no error, and no recovery path
    // short of a full page reload. This flag drives the amber
    // indeterminate ServiceUnavailable state (role="status") with a
    // retry action that re-fires the same fetch.
    const [loadError, setLoadError] = useState(false);
    // Definitive backend verdict (4xx: missing / not owned) — a permanent
    // condition, rendered as the terminal no-certificate screen, never as
    // the "temporary glitch, retry" card.
    const [notFound, setNotFound] = useState(false);
    // W12 - the wizard opens on the quotation. The renewal application is
    // created as soon as the certificate is loaded, because there is no longer
    // an upload step for the applicant to press "continue" on.
    const [step, setStep] = useState<RenewalStep>('quotation');
    const [renewalId, setRenewalId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        setIsDark(localStorage.getItem("theme") === "dark");
        if (!getStoredUser()) {
            window.location.href = HEALTH_LOGIN_ROUTE;
            return;
        }
        if (certId) loadCertificate(certId);
        else setLoading(false);
    }, [certId]);

    const loadCertificate = async (id: string) => {
        setLoading(true);
        setLoadError(false);
        try {
            const result = await api.get<Certificate>(`/api/certificates/${id}`);
            // apiClient already unwraps one envelope level (api-client.ts:410)
            // and the backend returns single-level `{ success, data: cert }`
            // (certificates.js:236) — so `result.data` IS the certificate.
            if (result.success && result.data) setCertificate(result.data);
            // Definitive 4xx (404 missing / not-owned per the IDOR contract):
            // the backend DID answer — retrying will not help.
            else if (result.status !== undefined && result.status < 500) setNotFound(true);
            // W1-RETRY: no more silent failure — surface the indeterminate
            // load-error state so the applicant gets a retry action.
            else setLoadError(true);
        } catch {
            console.error('Failed to load certificate');
            setLoadError(true);
        }
        finally { setLoading(false); }
    };

    const [renewalError, setRenewalError] = useState<string | null>(null);
    // V1-C / D3 — payment-pending notice surfaced on the payment step when
    // RENEWAL_PAYMENT_WIRED is false (current default). Decoupled from the
    // existing `renewalError` slot so the upload-step error UI is not
    // affected by the deferred-payment notice.
    const [paymentPendingMessage, setPaymentPendingMessage] = useState<string | null>(null);

    /**
     * W12 - create the renewal application.
     *
     * TWO defects fixed here, both of which made this button do nothing real:
     *
     *  1. URL. It POSTed to `/api/applications/renewal` (singular). The route
     *     is mounted at `/renewals` (routes/api/index.js). Verified against a
     *     running backend: singular answers 404, plural answers 401/400. The
     *     renewal button had never worked against a real backend; the E2E spec
     *     mocked the singular path, which is why nothing caught it.
     *  2. Body. It sent `{ previousApplicationId, certificateId, documentIds }`.
     *     The route reads `originalCertificateId || certificateId` and ignores
     *     the rest, so `certificateId` did work by fallback - but the canonical
     *     field is `originalCertificateId`, which is what the route's own
     *     contract documents and what renewal-service takes. The CALLER was
     *     changed rather than the route: the route's contract is the correct
     *     one, and `previousApplicationId` / `documentIds` are values the
     *     server neither needs nor reads - it derives the source application
     *     from the certificate itself.
     *
     * Pinned by src/__tests__/renewal-endpoint-contract.test.ts, which reads
     * BOTH this file and the route file so the two cannot drift apart again.
     */
    const createRenewal = async () => {
        if (!certificate) {
            setRenewalError(renewalCopy.errorNoCert);
            return;
        }
        setCreating(true);
        try {
            const result = await api.post<{ applicationId: string }>(
                '/api/applications/renewals',
                { originalCertificateId: certificate.id },
            );
            // apiClient already unwraps one envelope level — the backend
            // returns single-level `{ success, data: { applicationId } }`
            // (renewals.js) — so `result.data` IS that object.
            if (result.success && result.data?.applicationId) {
                setRenewalId(result.data.applicationId);
                setRenewalError(null);
            } else {
                // A refusal says why and what to do next (operator ruling 2026-10-03:
                // a renewal is a submission, so the door refuses filers who may not
                // submit for the certificate's holder). apiClient keeps the backend's
                // machine code in `code` (renewals.js sends it as `error`); an unknown
                // code keeps the generic line.
                const refusalCode = result.errorCode || result.code;
                setRenewalError(resolveErrorCode(
                    refusalCode ? { code: refusalCode } : null,
                    {
                        FORBIDDEN_NOT_OWNER: renewalCopy.errorNotOriginalFiler,
                        ENTITY_PERMISSION_DENIED: renewalCopy.errorNoSubmitRight,
                        APPLICANT_ENTITY_MISSING: renewalCopy.errorNoHolder,
                    },
                    renewalCopy.errorCreateFailed,
                ));
            }
        } catch {
            setRenewalError(renewalCopy.errorConnection);
        } finally {
            setCreating(false);
        }
    };

    // W12 - with no upload step there is no press to create the renewal on, so
    // it is created as soon as the certificate is in hand. Guarded on renewalId
    // so a re-render never files a second application.
    useEffect(() => {
        if (certificate && !renewalId && !creating && !renewalError) {
            void createRenewal();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [certificate]);

    const handlePaymentConfirm = async () => {
        // V1-C / D3 — REAL-MONEY-LOSS FIX.
        //
        // Previous behaviour: POST /api/payments/confirm (404 — endpoint
        // does not exist) inside a try/catch that swallowed the error,
        // then unconditionally jumped to the success step. The applicant
        // believed they had paid; the backend had no record. Removed.
        //
        // Current behaviour while RENEWAL_PAYMENT_WIRED === false:
        // surface a Thai notice on the payment step and DO NOT advance
        // to success. When backend support lands and the flag is flipped
        // to true, the success-jump should be replaced with a redirect
        // to the Stripe checkout flow (`/health/payments/checkout`)
        // rather than a local-only step. See block comment near
        // RENEWAL_PAYMENT_WIRED at top-of-file for the option choice.
        if (!RENEWAL_PAYMENT_WIRED) {
            setPaymentPendingMessage(renewalCopy.paymentPendingMessage);
            return;
        }
        // When the flag is flipped on in a future iteration the
        // applicant should be redirected to the Stripe checkout flow.
        // We intentionally do NOT call any local-only success jump here
        // — every payment confirmation must go through the canonical
        // /health/payments/checkout page so the checkout order is
        // persisted on the backend and settled by the Stripe webhook.
        setPaymentPendingMessage(renewalCopy.paymentPendingMessage);
    };

    if (loading) return <RenewalLoadingFallback />;

    // X1-FIX-C / C-3 — render the advisory banner above every step of
    // the wizard so applicants can't reach the payment step without
    // understanding the limitation up-front. The banner is identical on
    // each step; the per-step body renders unchanged below it.
    const banner = (
        <RenewalAdvisoryBanner
            supportEmail={advisory.contactEmail}
            dictBanner={{ title: advisory.title, body: advisory.body, contactCta: advisory.contactCta, contactFormCta: advisory.contactFormCta }}
        />
    );

    // W1-RETRY — certificate fetch failed (backend unreachable / 5xx / bad
    // envelope). Amber indeterminate ServiceUnavailable pattern (mirrors
    // the public verify page): role="status", never a definitive "not
    // found" verdict on a fetch failure, retry re-fires the SAME fetch.
    if (certId && loadError && !certificate) {
        return (
            <div className={`min-h-screen p-8 font-sans ${isDark ? 'bg-slate-900' : 'bg-surface-100'}`}>
                <div className="mx-auto max-w-3xl pt-16">
                    {banner}
                    <div
                        role="status"
                        data-testid="renewal-load-error"
                        className="w-full rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 shadow-sm"
                    >
                        <div className="flex items-start gap-3">
                            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
                                <AlertTriangle className="h-5 w-5" aria-hidden="true" focusable="false" />
                            </span>
                            <div className="min-w-0 flex-1 leading-snug">
                                <p className="text-base font-bold text-amber-800">{renewalCopy.loadErrorTitle}</p>
                                <p className="mt-1 text-sm text-amber-700">{renewalCopy.loadErrorBody}</p>
                                {renewalCopy.loadErrorSubline ? (
                                    <p className="mt-1 text-xs text-amber-700">{renewalCopy.loadErrorSubline}</p>
                                ) : null}
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        data-testid="renewal-load-retry"
                                        onClick={() => { void loadCertificate(certId); }}
                                        className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-amber-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2"
                                    >
                                        {dict.common?.fetchError?.retry || 'ลองอีกครั้ง'}
                                    </button>
                                    <Link
                                        href="/health/certificates"
                                        className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-amber-300 bg-white px-4 text-sm font-semibold text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2"
                                    >
                                        {renewalCopy.goToCertList}
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (!certificate && (!certId || notFound)) {
        return (
            <div className={`min-h-screen p-8 font-sans ${isDark ? 'bg-slate-900' : 'bg-surface-100'}`}>
                <div className="mx-auto max-w-3xl pt-16">
                    {banner}
                </div>
                <div className="mx-auto max-w-xl pt-4 text-center">
                    <div className={`mb-6 inline-flex h-20 w-20 items-center justify-center rounded-2xl ${isDark ? 'bg-primary-500/15' : 'bg-primary-50'}`}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={isDark ? '#34D399' : '#16A34A'} strokeWidth="1.5"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" /></svg>
                    </div>
                    <h1 className={`mb-4 text-2xl font-semibold ${isDark ? 'text-surface-100' : 'text-foreground'}`}>{renewalCopy.title}</h1>
                    <p className={`mb-6 ${isDark ? 'text-muted-foreground' : 'text-muted-foreground'}`}>{notFound ? renewalCopy.errorNoCert : renewalCopy.noCertBody}</p>
                    <Link href="/health/certificates" className="inline-flex items-center gap-2 rounded-xl bg-primary px-7 py-3.5 font-semibold text-white shadow-sm">{renewalCopy.goToCertList}</Link>
                </div>
            </div>
        );
    }

    switch (step) {
        // V1 review M-3: success case removed (dead code post-D3); the
        // disabled-payment notice is rendered inline in PaymentStep instead.
        case 'payment': return (
            <>
                {banner}
                {paymentPendingMessage && (
                    <div
                        role="alert"
                        data-testid="renewal-payment-pending"
                        className="mb-4 w-full rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm font-medium text-amber-800"
                    >
                        {paymentPendingMessage}
                    </div>
                )}
                <PaymentStep renewalId={renewalId} isDark={isDark} onBack={() => setStep('invoice')} onConfirm={handlePaymentConfirm} />
            </>
        );
        case 'invoice': return (
            <>
                {banner}
                <InvoiceStep certificate={certificate} renewalId={renewalId} isDark={isDark} onBack={() => setStep('quotation')} onProceed={() => setStep('payment')} />
            </>
        );
        // W12 - 'quotation' IS the entry step, and the step the page starts on, so
        // the refusal card is rendered here. It used to sit only on the default arm,
        // which the page never reaches: a refused renewal showed no message at all
        // (found 2026-10-03 while mapping the refusal codes). The renewal
        // application is created by the effect above; until it exists the applicant
        // sees the wizard with an empty case number rather than a blank screen.
        case 'quotation':
        default: return (
            <>
                {banner}
                {renewalError && (
                    <div role="alert" data-testid="renewal-create-error" className="mb-4 w-full rounded-xl bg-red-50 px-5 py-3 text-sm font-medium text-red-700">
                        {renewalError}
                    </div>
                )}
                <QuotationStep certificate={certificate} renewalId={renewalId} isDark={isDark} onBack={() => { window.location.href = '/health/certificates'; }} onProceed={() => setStep('invoice')} />
            </>
        );
    }
}

export default function RenewalPage() {
    return <Suspense fallback={<RenewalLoadingFallback />}><RenewalContent /></Suspense>;
}
