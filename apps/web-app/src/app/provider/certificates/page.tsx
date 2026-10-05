'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, CalendarClock, FileBadge2, RefreshCcw } from 'lucide-react';
import ProviderLayout from '../components/provider-layout';
import { useLanguage } from '@/lib/i18n/language-context';
import { providerApiPaths } from '@/lib/services/provider-api';
import { apiClient } from '@/lib/api/api-client';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { DataTable } from '@/components/ui/data-table';

interface DashboardSummary {
  totalActive: number;
  expiring30Days: number;
  expiring90Days: number;
  renewalRate: number;
}

interface SummaryGroup {
  standardName?: string | null;
  province?: string | null;
  count: number;
}

interface ExpiringCertificate {
  id: string;
  certificateNumber: string;
  farmName?: string | null;
  standardName?: string | null;
  province?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  status?: string | null;
  user?: {
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    phoneNumber?: string | null;
  } | null;
}

interface CertificatesDashboardPayload {
  summary: DashboardSummary;
  byStandard: SummaryGroup[];
  byProvince: SummaryGroup[];
  expiringList: ExpiringCertificate[];
}

const DEFAULT_PAYLOAD: CertificatesDashboardPayload = {
  summary: {
    totalActive: 0,
    expiring30Days: 0,
    expiring90Days: 0,
    renewalRate: 0,
  },
  byStandard: [],
  byProvince: [],
  expiringList: [],
};

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysUntil(value?: string | null): number | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.ceil((date.getTime() - Date.now()) / oneDay);
}

function normalizeRole(role?: string | null): string {
  return String(role || '').trim().toLowerCase();
}

function MetricTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <Card className="rounded-xl">
      <CardContent className="p-4">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export default function ProviderCertificatesPage() {
  // FU-3 (full-system audit area J): this page rendered 100% English with no
  // useLanguage — the chrome LanguageToggle could not localize it. All copy
  // now resolves from dict.provider.certificates (Thai default) with the
  // previous English strings as fallbacks.
  const { dict } = useLanguage();
  const cDict = dict.provider?.certificates;
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CertificatesDashboardPayload>(DEFAULT_PAYLOAD);
  const [role, setRole] = useState('');
  const [lastSync, setLastSync] = useState<string>('-');

  const canTriggerNotify = useMemo(() => {
    const normalized = normalizeRole(role);
    return normalized === 'system_admin_dtam' || normalized === 'system_admin_dtam';
  }, [role]);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Get user role from /me endpoint
      const meRes = await apiClient.get<{ role?: string; canonicalRole?: string }>('/auth/provider/me');
      if (meRes.success && meRes.data) {
        setRole(meRes.data.canonicalRole || meRes.data.role || '');
      }

      const response = await apiClient.get<CertificatesDashboardPayload>(providerApiPaths.certificatesDashboard);

      if (!response.success || !response.data) {
        throw new Error(response.error || cDict?.errors?.loadFailed || 'Unable to load certificates dashboard');
      }

      const mapped = response.data;
      setData({
        summary: mapped.summary || DEFAULT_PAYLOAD.summary,
        byStandard: Array.isArray(mapped.byStandard) ? mapped.byStandard : [],
        byProvince: Array.isArray(mapped.byProvince) ? mapped.byProvince : [],
        expiringList: Array.isArray(mapped.expiringList) ? mapped.expiringList : [],
      });
      setLastSync(formatDate(new Date().toISOString()));
    } catch (fetchError: unknown) {
      setData(DEFAULT_PAYLOAD);
      setError(fetchError instanceof Error ? fetchError.message : cDict?.errors?.loadFailed || 'Unable to load certificates dashboard');
      setLastSync('-');
    } finally {
      setLoading(false);
    }
  }, [cDict]);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  const notifyExpiringSoon = async () => {
    setSending(true);
    setError(null);
    try {
      const response = await apiClient.post(providerApiPaths.certificatesBulkNotify, { daysBeforeExpiry: 30 });

      if (!response.success) {
        throw new Error(response.error || cDict?.errors?.notifyFailed || 'Unable to queue renewal notifications');
      }

      await fetchDashboard();
    } catch (notifyError: unknown) {
      setError(notifyError instanceof Error ? notifyError.message : cDict?.errors?.notifyFailed || 'Unable to queue renewal notifications');
    } finally {
      setSending(false);
    }
  };

  return (
    <ProviderLayout title={cDict?.title || "Certificates"} subtitle={cDict?.subtitle || "Certification lifecycle and renewal monitoring"}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileBadge2 className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold text-foreground">{cDict?.heading || "Certificate Operations"}</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void fetchDashboard()}>
              <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
              {cDict?.refresh || "Refresh"}
            </Button>
            {canTriggerNotify ? (
              <Button type="button" size="sm" disabled={sending} onClick={notifyExpiringSoon}>
                <BellRing className="mr-1.5 h-3.5 w-3.5" />
                {sending ? (cDict?.queueing || 'Queueing...') : (cDict?.notifyExpiry || 'Notify 30-day expiry')}
              </Button>
            ) : null}
          </div>
        </div>

        {error ? (
          <Card className="border-destructive/30 bg-destructive/10">
            <CardContent className="p-4 text-sm font-medium text-destructive">{error}</CardContent>
          </Card>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricTile label={cDict?.metrics?.active || "Active certificates"} value={data.summary.totalActive} hint={`${cDict?.metrics?.lastSync || "Last sync"} ${lastSync}`} />
          <MetricTile label={cDict?.metrics?.expiring30 || "Expiring in 30 days"} value={data.summary.expiring30Days} />
          <MetricTile label={cDict?.metrics?.expiring90 || "Expiring in 90 days"} value={data.summary.expiring90Days} />
          <MetricTile label={cDict?.metrics?.renewalHealth || "Renewal health"} value={`${data.summary.renewalRate}%`} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle>{cDict?.byStandard || "By Standard"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {loading ? (
                [0, 1, 2].map((item) => <div key={item} className="h-10 animate-pulse rounded bg-muted" />)
              ) : data.byStandard.length === 0 ? (
                <p className="text-sm text-muted-foreground">{cDict?.noStandardData || "No standard distribution data"}</p>
              ) : (
                data.byStandard.map((item, index) => (
                  <div key={`${item.standardName || 'unknown'}-${index}`} className="flex items-center justify-between rounded-lg bg-muted/35 px-3 py-2">
                    <p className="text-sm font-medium text-foreground">{item.standardName || cDict?.unknownStandard || 'Unknown standard'}</p>
                    <Badge tone="info">{Number(item.count || 0).toLocaleString('th-TH')}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl">
            <CardHeader>
              <CardTitle>{cDict?.topProvinces || "Top Provinces"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {loading ? (
                [0, 1, 2].map((item) => <div key={item} className="h-10 animate-pulse rounded bg-muted" />)
              ) : data.byProvince.length === 0 ? (
                <p className="text-sm text-muted-foreground">{cDict?.noProvinceData || "No province distribution data"}</p>
              ) : (
                data.byProvince.map((item, index) => (
                  <div key={`${item.province || 'unknown'}-${index}`} className="flex items-center justify-between rounded-lg bg-muted/35 px-3 py-2">
                    <p className="text-sm font-medium text-foreground">{item.province || cDict?.unknownProvince || 'Unknown province'}</p>
                    <Badge tone="primary">{Number(item.count || 0).toLocaleString('th-TH')}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>{cDict?.expiringTitle || "Expiring Certificates (within 90 days)"}</CardTitle>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              {cDict?.autoSorted || "Auto-sorted by nearest expiry"}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((item) => (
                  <div key={item} className="h-12 animate-pulse rounded bg-muted" />
                ))}
              </div>
            ) : (
              // Wave E.2-D PR-3: replace inline <Table> with DataTable.
              // Sortable expiry/farm/province + 25-row pages + URL state
              // sync (?certs_sort=... / ?certs_page=N) for shareable
              // links. Default sort = nearest expiry first (matches the
              // header subtitle "Auto-sorted by nearest expiry").
              <DataTable<ExpiringCertificate>
                data={data.expiringList}
                rowKey="id"
                pageSize={25}
                urlStateKey="certs"
                defaultSort={{ key: 'expiryDate', dir: 'asc' }}
                emptyState={cDict?.emptyExpiring || "No certificates expiring within 90 days."}
                columns={[
                  {
                    key: 'certificateNumber',
                    header: cDict?.table?.certificate || 'Certificate',
                    sortable: true,
                    render: (cert) => <span className="font-semibold">{cert.certificateNumber || '-'}</span>,
                    getSortValue: (cert) => cert.certificateNumber ?? '',
                  },
                  {
                    key: 'farmName',
                    header: cDict?.table?.farm || 'Farm',
                    sortable: true,
                    render: (cert) => cert.farmName || '-',
                    getSortValue: (cert) => cert.farmName ?? '',
                  },
                  {
                    key: 'standardName',
                    header: cDict?.table?.standard || 'Standard',
                    sortable: true,
                    render: (cert) => cert.standardName || '-',
                    getSortValue: (cert) => cert.standardName ?? '',
                  },
                  {
                    key: 'province',
                    header: cDict?.table?.province || 'Province',
                    sortable: true,
                    render: (cert) => cert.province || '-',
                    getSortValue: (cert) => cert.province ?? '',
                  },
                  {
                    key: 'expiryDate',
                    header: cDict?.table?.expiry || 'Expiry',
                    sortable: true,
                    render: (cert) => {
                      const remainingDays = daysUntil(cert.expiryDate);
                      return (
                        <div className="space-y-1">
                          <p>{formatDate(cert.expiryDate)}</p>
                          <Badge tone={remainingDays !== null && remainingDays <= 30 ? 'warning' : 'info'}>
                            {remainingDays === null ? (cDict?.unknown || 'Unknown') : `${remainingDays} ${cDict?.daysLeftSuffix || 'days left'}`}
                          </Badge>
                        </div>
                      );
                    },
                    getSortValue: (cert) => cert.expiryDate ?? '',
                  },
                  {
                    key: 'contact',
                    header: cDict?.table?.contact || 'Contact',
                    render: (cert) => (
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          {[cert.user?.firstName, cert.user?.lastName].filter(Boolean).join(' ') || '-'}
                        </p>
                        <p className="text-xs text-muted-foreground">{cert.user?.email || '-'}</p>
                      </div>
                    ),
                  },
                ]}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </ProviderLayout>
  );
}

