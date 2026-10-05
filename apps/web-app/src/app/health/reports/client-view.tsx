'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Calendar, CheckCircle, Clock,
  AlertTriangle, ChevronRight, Send,
  Award, Info,
} from 'lucide-react';

import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { SummaryHeader } from '@/components/feature';
import { apiClient as api } from '@/lib/api/api-client';
import { AuthService } from '@/lib/services/auth-service';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { useLanguage } from '@/lib/i18n/language-context';

import {
  type ScheduleItem,
  type ScheduleData,
  type ReportModalData,
  THAI_MONTHS,
  REPORT_TYPE_INFO,
} from './report-types';
import { ReportModal } from './report-modal';

export default function ReportCenterPage() {
  const router = useRouter();
  const { dict, language } = useLanguage();
  const reportsCopy = dict.health.reports;
  const [loading, setLoading] = useState(true);
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);
  const [selectedCert, setSelectedCert] = useState<string>('all');

  // Report form modal
  const [modalData, setModalData] = useState<ReportModalData | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const loadSchedule = async () => {
      const user = AuthService.getUser();
      if (!user) {
        router.replace('/auth/health/login');
        return;
      }

      try {
        const res = await api.get<ScheduleData>('/api/report-submissions/schedule');
        // apiClient already unwraps one envelope level (api-client.ts:410)
        // and the backend returns single-level `{ success, data: {...} }`
        // (report-submissions.js:120) — so `res.data` IS the schedule object.
        if (res.data) {
          setScheduleData(res.data);
        } else {
          // Fallback: no API available yet
          setScheduleData({
            certificates: [],
            schedule: [],
            summary: { total: 0, submitted: 0, pending: 0, overdue: 0 },
          });
        }
      } catch {
        // API may not exist yet — show empty state
        setScheduleData({
          certificates: [],
          schedule: [],
          summary: { total: 0, submitted: 0, pending: 0, overdue: 0 },
        });
      } finally {
        setLoading(false);
      }
    };

    void loadSchedule();
  }, [router]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner className="h-8 w-8 text-primary" />
      </div>
    );
  }

  const data = scheduleData!;
  const hasCertificates = data.certificates.length > 0;

  // Filter schedule by selected certificate
  const filteredSchedule = selectedCert === 'all'
    ? data.schedule
    : data.schedule.filter(s => s.certificateId === selectedCert);

  // Group by month
  const groupedByMonth = filteredSchedule.reduce((acc, item) => {
    const key = `${item.year}-${String(item.month).padStart(2, '0')}`;
    if (!acc[key]) acc[key] = { month: item.month, year: item.year, items: [] };
    acc[key].items.push(item);
    return acc;
  }, {} as Record<string, { month: number; year: number; items: ScheduleItem[] }>);

  const sortedMonths = Object.keys(groupedByMonth).sort().reverse();

  return (
    // Wave E.2-B: SummaryHeader replaces inline title + description (gutter from
    // DashboardLayout's <main>).
    // Full-width (2026-06-10): owner directive — fill the screen on PC. NOTE: reports is
    // a single-column timeline; if it reads sparse at full width, grid the timeline
    // (follow-up) rather than re-narrow the container.
    <div className="w-full space-y-6">
      <SummaryHeader
        eyebrow={reportsCopy.eyebrow}
        title={reportsCopy.title}
        description={reportsCopy.description}
      />

      {/* No certificates */}
      {!hasCertificates && (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card py-12">
          <Award className="h-12 w-12 text-muted-foreground/30" />
          <div className="text-center">
            <p className="text-sm font-bold text-foreground">{reportsCopy.emptyNoCertsTitle}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {reportsCopy.emptyNoCertsBody}
            </p>
          </div>
          <Button asChild className="rounded-full">
            <Link href="/health/applications/new">{reportsCopy.applyCta}</Link>
          </Button>
        </div>
      )}

      {hasCertificates && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: reportsCopy.summary.total, value: data.summary.total, color: 'text-foreground', bg: 'bg-zinc-50' },
              { label: reportsCopy.summary.submitted, value: data.summary.submitted, color: 'text-leaf-700', bg: 'bg-leaf-soft' },
              { label: reportsCopy.summary.pending, value: data.summary.pending, color: 'text-amber-700', bg: 'bg-amber-50' },
              { label: reportsCopy.summary.overdue, value: data.summary.overdue, color: 'text-red-700', bg: 'bg-red-50' },
            ].map((stat) => (
              <div key={stat.label} className={`rounded-xl ${stat.bg} p-3 text-center`}>
                <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
                <p className="text-[10px] text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Overdue Warning */}
          {data.summary.overdue > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/50 p-4">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
              <div className="text-xs text-red-700">
                <p className="font-bold">{reportsCopy.overdueTitle.replace('{count}', String(data.summary.overdue))}</p>
                <p className="mt-1">
                  {reportsCopy.overdueBody}
                </p>
              </div>
            </div>
          )}

          {/* Certificate Filter */}
          {data.certificates.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setSelectedCert('all')}
                className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                  selectedCert === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {reportsCopy.filterAll}
              </button>
              {data.certificates.map((cert) => (
                <button
                  key={cert.id}
                  onClick={() => setSelectedCert(cert.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${
                    selectedCert === cert.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {cert.farmName}
                </button>
              ))}
            </div>
          )}

          {/* Report Schedule grouped by month */}
          {sortedMonths.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <Clock className="mx-auto h-8 w-8 text-muted-foreground/30" />
              <p className="mt-2 text-sm text-muted-foreground">{reportsCopy.emptyNoReports}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {sortedMonths.map((monthKey, mIdx) => {
                const group = groupedByMonth[monthKey];
                if (!group) {
                  return null;
                }
                return (
                  <motion.div
                    key={monthKey}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: mIdx * 0.05 }}
                  >
                    {/* Month header */}
                    <div className="mb-2 flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <h3 className="text-sm font-bold text-foreground">
                        {THAI_MONTHS[group.month - 1]} {group.year}
                      </h3>
                    </div>

                    {/* Reports in month */}
                    <div className="space-y-2">
                      {group.items.map((item, iIdx) => {
                        const typeInfo = REPORT_TYPE_INFO[item.reportType] || { icon: '?', color: 'bg-zinc-50 text-zinc-700' };
                        const isSubmitted = item.status !== 'NOT_SUBMITTED';

                        return (
                          <motion.div
                            key={`${item.certificateId}-${item.reportType}-${item.month}`}
                            initial={{ opacity: 0, x: -4 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: mIdx * 0.05 + iIdx * 0.03 }}
                            className={`rounded-xl border p-4 ${
                              item.isOverdue
                                ? 'border-red-200 bg-red-50/20'
                                : isSubmitted
                                  ? 'border-leaf-300 bg-leaf-soft/20'
                                  : 'border-border bg-card'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              {/* Report type badge */}
                              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${typeInfo.color}`}>
                                ภ.ท.{typeInfo.icon}
                              </div>

                              {/* Content */}
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-bold text-foreground">
                                    {item.reportTypeName}
                                  </p>
                                  {item.isOverdue && (
                                    <Badge className="rounded-full border-none bg-red-100 px-2 py-0 text-[10px] font-bold text-red-700">
                                      {reportsCopy.badgeOverdue}
                                    </Badge>
                                  )}
                                  {isSubmitted && (
                                    <Badge className="rounded-full border-none bg-leaf-soft px-2 py-0 text-[10px] font-bold text-leaf-onSoft">
                                      {item.status === 'SUBMITTED' ? reportsCopy.statusSubmitted :
                                        item.status === 'APPROVED' ? reportsCopy.statusApproved :
                                          item.status === 'REJECTED' ? reportsCopy.statusRejected :
                                            item.status === 'DRAFT' ? reportsCopy.statusDraft : item.status}
                                    </Badge>
                                  )}
                                </div>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {item.farmName} {reportsCopy.certLabel.replace('{certNumber}', item.certificateNumber)}
                                </p>
                                {item.submittedAt && (
                                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                                    {reportsCopy.submittedOn.replace('{date}', new Date(item.submittedAt).toLocaleDateString(language === 'en' ? 'en-US' : 'th-TH'))}
                                  </p>
                                )}
                              </div>

                              {/* Action */}
                              {!isSubmitted ? (
                                <Button
                                  size="sm"
                                  className="shrink-0 gap-1 rounded-full text-xs"
                                  onClick={() => {
                                    setFormValues({});
                                    setSubmitError(null);
                                    setModalData({
                                      certificateId: item.certificateId,
                                      certificateNumber: item.certificateNumber,
                                      farmName: item.farmName,
                                      reportType: item.reportType,
                                      reportTypeName: item.reportTypeName,
                                      month: item.month,
                                      year: item.year,
                                    });
                                  }}
                                >
                                  <Send className="h-3 w-3" />
                                  {reportsCopy.submitCta}
                                </Button>
                              ) : item.status === 'DRAFT' ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="shrink-0 gap-1 rounded-full text-xs"
                                  onClick={() => {
                                    toast.info(reportsCopy.opening);
                                  }}
                                >
                                  {reportsCopy.editCta}
                                  <ChevronRight className="h-3 w-3" />
                                </Button>
                              ) : (
                                <CheckCircle className="h-5 w-5 shrink-0 text-leaf-600" />
                              )}
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Info about report types */}
          <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
            <div className="text-xs text-blue-700">
              <p className="font-bold">{reportsCopy.aboutTitle}</p>
              <p className="mt-1">
                {reportsCopy.aboutPT27}
              </p>
              <p className="mt-0.5">
                {reportsCopy.aboutPT28}
              </p>
              <p className="mt-1 text-blue-600">
                {reportsCopy.aboutFooter}
              </p>
            </div>
          </div>
        </>
      )}

      {/* ── Report Form Modal ── */}
      {modalData && (
        <ReportModal
          modalData={modalData}
          formValues={formValues}
          setFormValues={setFormValues}
          submitting={submitting}
          setSubmitting={setSubmitting}
          submitError={submitError}
          setSubmitError={setSubmitError}
          onClose={() => setModalData(null)}
          onSuccess={(data) => setScheduleData(data)}
        />
      )}
    </div>
  );
}
