'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Calendar, ChevronRight, Leaf, Search } from 'lucide-react';

import { EmptyState } from '@/components/feature/empty-state';
import { FileSearch } from 'lucide-react';
import { apiClient } from '@/lib/api/api-client';
import { providerApiPaths } from '@/lib/services/provider-api';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Spinner } from '@/components/ui/spinner';
import { DataTable } from '@/components/ui/data-table';
import { formatThaiDate } from '@/utils/thai-date';
import { useLanguage } from '@/lib/i18n/language-context';
import { getSlaAgingBadge } from './sla-aging';
import {
  statusTone,
  STATUS_BADGE_CLASSES,
} from './[id]/provider-application-detail-config';

import ProviderLayout from '../components/provider-layout';

interface Application {
  id: string;
  applicantName: string;
  plantType: string;
  status: string;
  workflowState?: string;
  legacyStatus?: string;
  submittedAt: string;
  createdAt?: string;
  // C3 ("งานนี้พาสไปที่ใคร"): the doc-review assignment surfaced by the list
  // endpoint, so each row can show who the case was passed to + by whom.
  assignment?: {
    reviewerId: string;
    reviewerName?: string | null;
    assignedByName?: string | null;
    assignedAt?: string | null;
  } | null;
}


const REVIEW_WORKFLOW_STATES = ['SUBMITTED', 'DOC_FEE_PAID', 'ASSIGNED_FOR_REVIEW', 'REVISION_REQUESTED'] as const;
const AUDIT_WORKFLOW_STATES = ['AUDIT_FEE_PAID', 'AUDIT_CONFIRMED', 'CAR_PENDING', 'CAR_REVIEWING'] as const;

const getWorkflowStatus = (application: Application) =>
  String(application.workflowState || application.status || '').toUpperCase();


export default function ProviderApplicationsPage() {
  const { dict } = useLanguage();
  const [applications, setApplications] = useState<Application[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  // P1-J (Wave-3): server-side applicant search. The list header copy promised
  // "search for applicants" but the page fetched once unfiltered. `search` is the
  // raw input; `debouncedSearch` (300ms) is what we send as ?q to the backend list
  // endpoint (routes/api/provider/applications.js already honours ?q — contains
  // match on applicationNumber / healthId / firstName / lastName, tenant-scoped).
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;

    const loadApplications = async () => {
      setIsLoading(true);
      try {
        // Server-side ?q filter when a search term is present; otherwise the
        // unfiltered list. encodeURIComponent guards Thai names / spaces.
        const url = debouncedSearch
          ? `${providerApiPaths.applicationsList}?q=${encodeURIComponent(debouncedSearch)}`
          : providerApiPaths.applicationsList;
        const result = await apiClient.get<{ applications: Application[] }>(url);
        if (active && result.success && result.data?.applications) {
          setApplications(result.data.applications);
        }
      } catch (error) {
        console.error('Failed to fetch applications:', error);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadApplications();

    return () => {
      active = false;
    };
  }, [debouncedSearch]);

  const filteredApplications = useMemo(
    () => applications.filter((application) => filter === 'all' || getWorkflowStatus(application) === filter),
    [applications, filter]
  );

  const listDict = dict.provider?.applicationsList;
  const summaryMetrics = useMemo(
    () => [
      { label: listDict?.stats?.all || 'All Cases', value: String(applications.length), icon: 'ALL' },
      {
        label: listDict?.stats?.pendingReview || 'Pending Review',
        value: String(
          applications.filter((application) => REVIEW_WORKFLOW_STATES.includes(getWorkflowStatus(application) as (typeof REVIEW_WORKFLOW_STATES)[number])).length
        ),
        icon: 'REVIEW',
      },
      {
        label: listDict?.stats?.pendingAudit || 'Pending Audit',
        value: String(
          applications.filter((application) => AUDIT_WORKFLOW_STATES.includes(getWorkflowStatus(application) as (typeof AUDIT_WORKFLOW_STATES)[number])).length
        ),
        icon: 'AUDIT',
      },
      {
        label: listDict?.stats?.certified || 'Certified',
        value: String(applications.filter((application) => getWorkflowStatus(application) === 'CERTIFIED').length),
        icon: 'CERT',
      },
    ],
    [applications, listDict?.stats]
  );

  const filterLabel = (value: string): string => {
    const filters = listDict?.filters;
    if (value === 'all') return filters?.all || 'All';
    if (value === 'SUBMITTED') return filters?.submitted || 'SUBMITTED';
    if (value === 'ASSIGNED_FOR_REVIEW') return filters?.assigned || 'ASSIGNED FOR REVIEW';
    if (value === 'APPROVED') return filters?.approved || 'APPROVED';
    if (value === 'CERTIFIED') return filters?.certified || 'CERTIFIED';
    if (value === 'REVISION_REQUESTED') return filters?.revision || 'REVISION REQUESTED';
    if (value === 'DOC_APPROVED') return filters?.docApproved || 'DOC APPROVED';
    return value.replace(/_/g, ' ');
  };

  // Full-page spinner only on the FIRST load (no rows + no active search).
  // Once the list has rendered, re-fetches (search/debounce) keep the search
  // box + chips mounted so the input never disappears mid-typing.
  if (isLoading && applications.length === 0 && !debouncedSearch) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <ProviderLayout title={listDict?.title || 'Applications Management'} subtitle={listDict?.subtitle || 'Review and manage GACP certification requests'}>
      <div className="animate-fade-in space-y-4">

        {/* ── Fiori object-list header band ──────────────────────────────
            Dense enterprise header consistent with the object-page detail
            view: eyebrow + title + description on the left, a compact
            metric strip below (small value over label, tight columns).
            Token-only colors. */}
        <section className="rounded-lg border border-border bg-card">
          <div className="border-b border-border/60 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              {listDict?.eyebrow || 'GACP Platform'}
            </p>
            <h2 className="mt-0.5 text-xl font-semibold text-foreground">
              {listDict?.heading || 'Applications Directory'}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {listDict?.description || 'Access all submitted GACP certification applications. You can filter by status, search for applicants, and manage the workflow of each case.'}
            </p>
          </div>
          <dl className="flex flex-wrap gap-x-8 gap-y-3 px-4 py-3">
            {summaryMetrics.map((metric) => (
              <div key={metric.label} className="min-w-[6rem]">
                <dt className="text-2xl font-semibold tabular-nums text-foreground">{metric.value}</dt>
                <dd className="mt-0.5 text-xs text-muted-foreground">
                  {metric.label}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex flex-wrap gap-2">
            {/* X2-FIX-A H-5: add REVISION_REQUESTED + DOC_APPROVED
                chips so DTAM reviewers can isolate the "applicant is
                revising" and "documents approved, awaiting next phase"
                buckets. Both states are canonical (workflow-states.ts
                lines 22-23) and the backend listing already returns
                applications in either state — only the filter chip was
                missing. Chips are appended at the end to preserve the
                existing ordering convention. */}
            {['all', 'SUBMITTED', 'ASSIGNED_FOR_REVIEW', 'APPROVED', 'CERTIFIED', 'REVISION_REQUESTED', 'DOC_APPROVED'].map((value) => (
              <Button
                key={value}
                variant={filter === value ? 'default' : 'outline'}
                size="sm"
                className="h-8 min-h-[44px] rounded-md px-3 text-xs font-medium sm:min-h-0"
                onClick={() => setFilter(value)}
                data-testid={`filter-chip-${value}`}
              >
                {filterLabel(value)}
              </Button>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">
            {(listDict?.totalRecords || 'Total {count} Records').replace('{count}', String(filteredApplications.length))}
          </div>
        </div>

        {/* P1-J (Wave-3): applicant search box. Debounced (300ms) and wired to
            the backend list ?q param (contains match on applicationNumber /
            healthId / name, tenant-scoped) — the header copy promised search
            but the page previously fetched once unfiltered. */}
        <div className="relative max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={listDict?.searchPlaceholder || 'ค้นหาชื่อผู้สมัคร / เลขคำขอ / เลขบัตร'}
            aria-label={listDict?.searchAria || 'ค้นหาคำขอ'}
            data-testid="applications-search-input"
            className="h-11 min-h-[44px] w-full rounded-lg border border-border bg-card pl-9 pr-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
          />
        </div>

        {/* Wave E.2-D PR-3: replace inline <Table> with DataTable.
            Adds sortable columns, sticky header, density toggle, page
            size 25, and URL state sync (?apps_sort=... / ?apps_page=N)
            for shareable links. EmptyState rendering moved into the
            `emptyState` slot. */}
        <DataTable<Application>
          data={filteredApplications}
          rowKey="id"
          pageSize={25}
          urlStateKey="apps"
          defaultDensity="compact"
          defaultSort={{ key: 'submittedAt', dir: 'desc' }}
          emptyState={
            <EmptyState
              icon={FileSearch}
              title={listDict?.empty?.title || 'No applications in this category'}
              hint={listDict?.empty?.hint || 'Try changing the filter above or make sure there are applications in this status.'}
            />
          }
          columns={[
            {
              key: 'submittedAt',
              header: listDict?.columns?.idSubmission || 'ID & Submission',
              sortable: true,
              render: (application) => {
                const slaBadge = getSlaAgingBadge(application);
                return (
                  <>
                    <p className="text-xs uppercase text-muted-foreground">
                      {application.id.slice(0, 8)}
                    </p>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-foreground">
                      <Calendar size={12} className="text-muted-foreground" />
                      {formatThaiDate(application.submittedAt)}
                    </div>
                    {slaBadge && (
                      <Badge
                        variant="outline"
                        className="mt-1.5 inline-flex items-center gap-1 rounded-md border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning"
                        data-testid="sla-aging-badge"
                      >
                        <AlertTriangle size={10} className="text-warning" aria-hidden="true" />
                        {slaBadge.label}
                      </Badge>
                    )}
                  </>
                );
              },
              getSortValue: (application) => application.submittedAt ?? '',
            },
            {
              key: 'applicantName',
              header: listDict?.columns?.applicantName || 'Applicant Name',
              sortable: true,
              render: (application) => (
                <div>
                  <span className="text-sm font-medium text-foreground">{application.applicantName}</span>
                  {/* C3 ("งานนี้พาสไปที่ใคร"): show the assigned reviewer + who
                      passed the job, so reviewers/staff see each case's origin. */}
                  {application.assignment?.reviewerId && (
                    <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                      ผู้ตรวจ: {application.assignment.reviewerName || '-'}
                      {application.assignment.assignedByName && (
                        <> · มอบหมายโดย {application.assignment.assignedByName}</>
                      )}
                    </p>
                  )}
                </div>
              ),
              getSortValue: (application) => application.applicantName ?? '',
            },
            {
              key: 'plantType',
              header: listDict?.columns?.plantType || 'Plant Type',
              sortable: true,
              render: (application) => (
                <Badge
                  variant="outline"
                  className="rounded-md border-none bg-muted/50 px-2 py-0.5 text-[11px] font-medium"
                >
                  <Leaf size={10} className="mr-1 inline text-muted-foreground" />
                  {application.plantType}
                </Badge>
              ),
              getSortValue: (application) => application.plantType ?? '',
            },
            {
              key: 'status',
              header: listDict?.columns?.status || 'Status',
              sortable: true,
              render: (application) => {
                // Reuse the object-page semantic status badge (statusTone +
                // STATUS_BADGE_CLASSES) so list + detail render identically.
                const status = statusTone(getWorkflowStatus(application));
                return (
                  <span
                    className={cn(
                      'inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold',
                      STATUS_BADGE_CLASSES[status.tone],
                    )}
                    data-testid="application-status-badge"
                  >
                    {status.label}
                  </span>
                );
              },
              getSortValue: (application) => getWorkflowStatus(application),
            },
            {
              key: 'actions',
              header: listDict?.columns?.actions || 'Actions',
              align: 'right',
              render: (application) => (
                <Button asChild variant="ghost" size="sm" className="h-8 min-h-[44px] w-8 min-w-[44px] rounded-md p-0 sm:min-h-0 sm:min-w-0">
                  <Link href={`/provider/applications/${application.id}`} aria-label={`เปิดคำขอ ${application.id.slice(0, 8)}`}>
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </Button>
              ),
            },
          ]}
        />
      </div>
    </ProviderLayout>
  );
}
