"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Award,
  Download,
  Calendar,
  QrCode,
  MapPin,
  Ruler,
  Eye,
  RefreshCw,
  FileBadge,
  ClipboardCheck,
  AlertCircle,
} from 'lucide-react';

import { apiClient as api } from '@/lib/api';

import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent } from '@/components/ui/primitives/card';
import { SummaryHeader } from '@/components/feature';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog';
import { PageSkeleton } from '@/components/ui/page-skeleton';
import { QrImage } from '@/components/ui/qr-image';
import { CertificateService } from '@/lib/services/certificate-service';
import { getCertBadgeKind, getCertCounters, getDaysRemaining } from './cert-status';
import { useLanguage } from '@/lib/i18n/language-context';
import { AREA_UNIT_LABEL, formatAreaSqm, legacyAreaToSqm } from '@/lib/area';
import { certificateValidityYears } from './validity-years';

interface CertFarm {
  name: string;
  type: string;
  province: string;
  district: string;
  subDistrict: string;
  location: string;
  totalArea: number | null;
  areaUnit: string;
}

interface CertAudit {
  score: number | null;
  auditorName: string | null;
  lastAuditDate: string | null;
}

interface Certificate {
  id: string;
  certificateNumber: string;
  applicationId: string;
  farmId: string;
  siteName: string;
  plantType: string;
  issuedDate: string;
  expiryDate: string;
  status: string;
  qrCode?: string;
  farm?: CertFarm | null;
  crops?: string[];
  audit?: CertAudit | null;
}


function formatDate(value: string, locale: string = 'th-TH'): string {
  if (!value) return '-';
  const date = new Date(value);
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

// getDaysRemaining lives in ./cert-status (shared with the summary counters
// so the badge and the counters can never drift on day math again).

interface CertStatusLabels {
  active: string;
  expiring: string;
  expired: string;
}

function getStatusLabel(status: string, daysLeft: number, labels: CertStatusLabels): { label: string; color: string; bg: string; dot: string } {
  // Delegate the kind decision to the shared helper so the badge NEVER
  // disagrees with the summary counters (both live in cert-status.ts). Only an
  // ACTIVE cert with time left is green/amber; EXPIRED/REVOKED/unknown = neutral.
  const kind = getCertBadgeKind(status, daysLeft);
  if (kind === 'expired') {
    return { label: labels.expired, color: 'text-slate-700', bg: 'bg-slate-100', dot: 'bg-slate-500' };
  }
  if (kind === 'expiring') {
    return { label: labels.expiring, color: 'text-amber-700', bg: 'bg-amber-50', dot: 'bg-amber-500' };
  }
  return { label: labels.active, color: 'text-leaf-700', bg: 'bg-leaf-soft', dot: 'bg-leaf-600' };
}

function getProgressPercent(issuedDate: string, expiryDate: string): number {
  const start = new Date(issuedDate).getTime();
  const end = new Date(expiryDate).getTime();
  const now = Date.now();
  const total = end - start;
  const elapsed = now - start;
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}

function getProgressColor(daysLeft: number): string {
  if (daysLeft <= 0) return 'bg-rose-500';
  if (daysLeft < 90) return 'bg-amber-500';
  if (daysLeft < 365) return 'bg-amber-400';
  return 'bg-leaf';
}

export default function HealthCertificatesPage() {
  const { dict, language } = useLanguage();
  const certDict = dict.certificates;
  const dateLocale = language === 'en' ? 'en-US' : 'th-TH';
  const [certs, setCertificates] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true);
  // V1-C / D9 — explicit error state.
  //
  // Previously the .catch handler swallowed network / 5xx errors by
  // setCertificates([]), making a backend outage look identical to the
  // "you have no certs yet" empty state — applicants were told they
  // had no certificates when the API was actually down. Distinct UI
  // for: (a) loading, (b) successfully fetched 0 rows, (c) fetch
  // failed (NEW state with retry CTA).
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [selectedCert, setSelectedCert] = useState<Certificate | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    api.get('/api/certificates/my')
      .then(res => {
        if (cancelled) return;
        // The apiClient envelope returns { success, data, error }.
        // A non-2xx response yields success=false with `error` set;
        // surface that as a fetch error so the user sees the retry CTA
        // instead of an empty-state lie.
        if (res.success === false) {
          setFetchError(res.error || certDict.loadFailHint);
          setCertificates([]);
          return;
        }
        const data = (res.data as { data?: Certificate[] })?.data || res.data as Certificate[] || [];
        setCertificates(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (cancelled) return;
        setFetchError(certDict.connectionError);
        setCertificates([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // certDict is derived from dict at render time; recreating the
    // effect on language switch is intentional so an in-flight retry
    // sees the freshly localized fallback messages. The deps array
    // intentionally omits certDict because the closure captures the
    // current snapshot — using retryToken is sufficient.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryToken]);

  if (loading) return <PageSkeleton type="list" />;

  // Summary counters — case-insensitive + exactly-one-bucket (cert-status.ts;
  // unit-tested). Strict 'ACTIVE' compare used to zero these out against the
  // backend's lowercase status while the card badge still showed ใช้งานได้.
  const { activeCount, expiringCount, expiredCount } = getCertCounters(certs);

  return (
    // Wave E.2-B: adopt SummaryHeader (consolidated title + 3-tile summary).
    // Full-width (2026-06-10): owner directive — fill the screen on PC. DashboardLayout's
    // <main> supplies the gutter; the certificate card grid spans the full viewport.
    <div className="w-full space-y-6">
      <SummaryHeader
        eyebrow={dict.eyebrow.applicantCertificates}
        title={certDict.title}
        description={certDict.subtitle}
        metrics={[
          // The card below already draws a distinct outage state instead of the empty
          // state. These three tiles were left out of it and still counted a list
          // nobody could read: '0 ใบรับรองที่ใช้งานได้' is a statement about a
          // farmer's certificate, made on a failed GET.
          { label: certDict.active, value: fetchError ? '—' : activeCount.toLocaleString(dateLocale), icon: '✅' },
          { label: certDict.expiring, value: fetchError ? '—' : expiringCount.toLocaleString(dateLocale), icon: '⏰' },
          { label: certDict.expired, value: fetchError ? '—' : expiredCount.toLocaleString(dateLocale), icon: '❌' },
        ]}
      />


      {/* V1-C / D9 — Certificate cards.
          Three distinct states (per RFC):
            1. fetchError set → red error card with retry button.
            2. fetchError null && certs.length === 0 → zinc empty card.
            3. fetchError null && certs.length > 0 → list of cards.
          The previous code collapsed (1) into (2), making outages
          indistinguishable from a never-certified applicant. */}
      {fetchError ? (
        <Card
          data-testid="cert-list-error"
          className="rounded-[1.375rem] border border-rose-200 bg-rose-50/60 p-12 text-center"
        >
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
            <AlertCircle className="h-6 w-6" aria-hidden="true" focusable="false" />
          </span>
          <h3 className="text-lg font-bold text-rose-800">{certDict.loadFailTitle}</h3>
          <p className="mt-1 text-sm text-rose-700">{fetchError}</p>
          <Button
            type="button"
            variant="white"
            className="mt-6"
            onClick={() => setRetryToken((t) => t + 1)}
          >
            {certDict.retry}
          </Button>
        </Card>
      ) : certs.length === 0 ? (
        <Card
          data-testid="cert-list-empty"
          className="rounded-[1.375rem] border border-dashed border-primary-200 bg-mint-soft p-12 text-center"
        >
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-leaf-soft text-leaf-onSoft">
            <FileBadge className="h-7 w-7" aria-hidden="true" focusable="false" />
          </span>
          <h3 className="text-lg font-bold text-foreground">{certDict.notFoundTitle}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{certDict.notFoundHint}</p>
          <Button asChild variant="primary" className="mt-6">
            <Link href="/health/applications/new">{certDict.newApplication}</Link>
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {certs.map((cert, idx) => {
            const daysLeft = getDaysRemaining(cert.expiryDate);
            const statusInfo = getStatusLabel(cert.status, daysLeft, { active: certDict.active, expiring: certDict.expiring, expired: certDict.expired });
            const progress = getProgressPercent(cert.issuedDate, cert.expiryDate);
            const validityYears = certificateValidityYears(cert.issuedDate, cert.expiryDate);
            const progressColor = getProgressColor(daysLeft);

            return (
              <motion.div
                key={cert.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.08 }}
              >
                {/* ui_kit reskin (Wave 3, 2026-06-09): certificate card now
                    mirrors the ref — a gradient header (forest→leaf, slate for
                    expired) carrying the GACP seal + cert number + status pill,
                    over a body with farm/plant, dates, a tappable QR thumbnail,
                    validity progress, auditor info, and the action buttons.
                    All data, links, and the QR dialog are unchanged. */}
                <Card className="flex h-full flex-col overflow-hidden rounded-[1.375rem]">
                  {/* Gradient header */}
                  <div
                    className={`flex items-center justify-between gap-3 px-5 py-4 text-white ${
                      statusInfo.label === certDict.expired
                        ? 'bg-muted-foreground'
                        : 'bg-gradient-to-br from-primary to-leaf'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/90 text-leaf-700">
                        <Award className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold leading-tight">{certDict.title}</p>
                        <p className="truncate font-mono text-[11px] text-white/85">{cert.certificateNumber}</p>
                      </div>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-foreground">
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusInfo.dot}`} />
                      {statusInfo.label}
                    </span>
                  </div>

                  <CardContent className="flex flex-1 flex-col space-y-4 p-5">

                    {/* Farm name + plant, with tappable QR thumbnail */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="truncate text-base font-bold leading-tight text-foreground">{cert.siteName}</h3>
                        {cert.plantType && (
                          <p className="mt-0.5 text-sm text-muted-foreground">{cert.plantType}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedCert(cert)}
                        aria-label={certDict.qrAltText}
                        className="flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-xl border border-primary-100 bg-white text-foreground transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leaf focus-visible:ring-offset-2"
                      >
                        <QrCode className="h-10 w-10" strokeWidth={1.2} />
                      </button>
                    </div>

                    {/* Location + Area */}
                    {cert.farm && (cert.farm.location || cert.farm.totalArea) && (
                      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                        {cert.farm.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5 text-leaf-700" />
                            {cert.farm.location}
                          </span>
                        )}
                        {/* boolean guard — `totalArea && ...` with totalArea=0 leaks a
                            literal "0" into the UI (walkthrough 2026-07-10) */}
                        {Number(cert.farm.totalArea) > 0 && (
                          <span className="flex items-center gap-1">
                            <Ruler className="h-3.5 w-3.5 text-leaf-700" />
                            {certDict.area} {formatAreaSqm(legacyAreaToSqm(cert.farm.totalArea, cert.farm.areaUnit))} {AREA_UNIT_LABEL}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Crop Tags */}
                    {cert.crops && cert.crops.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {cert.crops.map((crop, i) => (
                          <span key={i} className="inline-flex items-center rounded-full bg-leaf-soft px-2.5 py-0.5 text-xs font-medium text-leaf-onSoft">
                            {crop}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Dates */}
                    <div className="flex items-center gap-8 rounded-xl bg-mint-soft px-4 py-3 text-sm">
                      <div>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" /> {certDict.issuedAt}
                        </span>
                        <p className="mt-0.5 font-semibold tabular-nums text-foreground">{formatDate(cert.issuedDate, dateLocale)}</p>
                      </div>
                      <div>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3" /> {certDict.expiresAt}
                        </span>
                        <p className={`mt-0.5 font-semibold tabular-nums ${daysLeft < 90 ? 'text-amber-600' : 'text-foreground'}`}>
                          {formatDate(cert.expiryDate, dateLocale)}
                        </p>
                      </div>
                    </div>

                    {/* Validity Progress Bar */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between text-xs">
                        {/* The certificate's own span (validity-years.ts): 1 year under
                            today's rule, 3 for one issued before 2026-09-11. */}
                        <span className="text-muted-foreground">
                          {validityYears === null
                            ? certDict.validityProgressUnknown
                            : certDict.validityProgress.replace('{n}', String(validityYears))}
                        </span>
                        <span className={`font-semibold ${daysLeft <= 0 ? 'text-rose-600' : daysLeft < 90 ? 'text-amber-600' : 'text-leaf-700'}`}>
                          {daysLeft > 0 ? certDict.daysRemaining.replace('{n}', daysLeft.toLocaleString(dateLocale)) : certDict.expiredAlready}
                        </span>
                      </div>
                      <div className="h-[7px] w-full overflow-hidden rounded-full bg-mint-bg">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${progressColor}`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    {/* Auditor Info */}
                    {cert.audit && (cert.audit.auditorName || cert.audit.score) && (
                      <div className="flex items-center justify-between rounded-xl bg-mint-soft px-4 py-3 text-sm">
                        <div className="text-muted-foreground">
                          {cert.audit.auditorName && (
                            <p className="flex items-center gap-1">
                              <ClipboardCheck className="h-3.5 w-3.5 text-leaf-700" />
                              {certDict.auditor}: {cert.audit.auditorName}
                            </p>
                          )}
                          {cert.audit.lastAuditDate && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {certDict.lastAudit}: {formatDate(cert.audit.lastAuditDate, dateLocale)}
                            </p>
                          )}
                        </div>
                        {cert.audit.score != null && (
                          <div className="text-right">
                            <span className="text-xs text-muted-foreground">{certDict.score}:</span>
                            <p className="text-lg font-bold text-foreground">{cert.audit.score}<span className="text-sm font-normal text-muted-foreground">/100</span></p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="mt-auto flex flex-wrap gap-2 border-t border-mint-bg pt-4">
                      <Button
                        variant="white"
                        size="md"
                        className="min-h-[44px] flex-1"
                        asChild
                      >
                        {/* Iter 23 — link to the dedicated detail page
                            instead of opening the inline QR dialog so
                            applicants can deep-link, share, and print. */}
                        <Link href={`/health/certificates/${cert.id}`}>
                          <Eye className="mr-1.5 h-4 w-4" /> {certDict.viewCert}
                        </Link>
                      </Button>
                      <Button
                        variant="light"
                        size="md"
                        className="min-h-[44px] flex-1"
                        onClick={() => {
                          window.open(`/api/certificates/${cert.id}/download`, '_blank');
                        }}
                      >
                        <Download className="mr-1.5 h-4 w-4" /> {certDict.download}
                      </Button>
                      {daysLeft <= 365 && daysLeft > 0 && (
                        <Button
                          variant="primary"
                          size="md"
                          className="min-h-[44px] flex-1"
                          asChild
                        >
                          {/* X1-FIX-C / M-6 — pass certId so the renewal
                              wizard pre-selects the correct certificate.
                              Previously this linked to /health/applications/new
                              which started a fresh GACP application from
                              scratch instead of the renewal flow (the
                              `/health/applications/renewal` page already
                              reads ?certId= via useSearchParams). */}
                          <Link href={`/health/applications/renewal?certId=${cert.id}`}>
                            <RefreshCw className="mr-1.5 h-4 w-4" /> {certDict.renew}
                          </Link>
                        </Button>
                      )}
                      {daysLeft <= 0 && (
                        <Button
                          variant="destructive"
                          size="md"
                          className="min-h-[44px] flex-1"
                          asChild
                        >
                          {/* X1-FIX-C / M-6 — pass certId so the renewal
                              wizard pre-selects the correct certificate.
                              Previously this linked to /health/applications/new
                              which started a fresh GACP application from
                              scratch instead of the renewal flow (the
                              `/health/applications/renewal` page already
                              reads ?certId= via useSearchParams). */}
                          <Link href={`/health/applications/renewal?certId=${cert.id}`}>
                            <RefreshCw className="mr-1.5 h-4 w-4" /> {certDict.renew}
                          </Link>
                        </Button>
                      )}
                    </div>

                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* QR / Certificate Preview Dialog */}
      <Dialog open={!!selectedCert} onOpenChange={() => setSelectedCert(null)}>
        <DialogContent className="rounded-[1.375rem] border-none p-6 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center text-lg font-bold text-foreground">{certDict.title}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            {/* QR modules need true white behind them to keep scan
                contrast — this must NOT flip under dark mode. */}
            <div
              data-testid="cert-qr-preview-box"
              className="rounded-2xl border border-primary-100 bg-white p-5 shadow-inner dark:bg-white"
            >
              {selectedCert && (
                <QrImage
                  // Always generate client-side from the certificate's own
                  // verify URL (same source cert-detail trusts) rather than
                  // trusting the backend `qrCode` blob as primary — that
                  // blob can go stale. It is kept ONLY as a last-resort
                  // fallback if client-side generation itself errors.
                  value={CertificateService.getCertificateVerifyUrl(selectedCert.certificateNumber)}
                  alt={certDict.qrAltText}
                  size={192}
                  className="h-48 w-48"
                  fallbackSrc={selectedCert.qrCode ?? null}
                />
              )}
            </div>
            <div className="text-center">
              <p className="font-mono text-sm text-muted-foreground">{selectedCert?.certificateNumber}</p>
              <p className="mt-0.5 font-bold text-foreground">{selectedCert?.siteName}</p>
              {selectedCert?.farm?.location && (
                <p className="text-xs text-muted-foreground">{selectedCert.farm.location}</p>
              )}
            </div>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={() => setSelectedCert(null)}
            >
              {certDict.closeWindow}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
