"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card } from '@/components/ui/primitives/card';
import { Spinner } from '@/components/ui/spinner';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Hand,
  UserMinus,
  XCircle,
} from 'lucide-react';
import { providerApiPaths } from '@/lib/services/provider-api';
import { apiClient } from '@/lib/api/api-client';
import { useLanguage } from '@/lib/i18n/language-context';

type ActivityState = 'TODO' | 'CLAIMED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

interface ApplicationActivity {
  id: string;
  workType: string;
  candidateGroup: string;
  state: ActivityState;
  triggeredAtStage: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  completedByName: string | null;
  dueAt: string | null;
  warningAt: string | null;
  createdAt: string;
  claimedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  note: string | null;
  isOverdue: boolean;
}

const WORK_TYPE_LABEL: Record<string, string> = {
  SCHEDULING: 'จัดคิว/มอบหมาย',
  DOC_REVIEW: 'ตรวจเอกสาร',
  FIELD_AUDIT: 'ตรวจประเมินภาคสนาม',
  CAR_REVIEW: 'ตรวจ CAR',
  FINAL_APPROVAL: 'อนุมัติออกใบรับรอง',
  // RECEIPT_ISSUE omitted — issuance is automatic (auto-issue + auto-sign on
  // settlement), never a spawned work-activity, so the label is unreachable.
};

const STATE_LABEL: Record<ActivityState, string> = {
  TODO: 'รอรับงาน',
  CLAIMED: 'รับงานแล้ว',
  IN_PROGRESS: 'กำลังดำเนินการ',
  DONE: 'เสร็จสิ้น',
  CANCELLED: 'ยกเลิก',
};

function stateBadgeColor(state: ActivityState, isOverdue: boolean): 'red' | 'yellow' | 'blue' | 'green' | 'gray' {
  if (isOverdue && ['TODO', 'CLAIMED', 'IN_PROGRESS'].includes(state)) return 'red';
  if (state === 'DONE') return 'green';
  if (state === 'CANCELLED') return 'gray';
  if (state === 'CLAIMED' || state === 'IN_PROGRESS') return 'blue';
  return 'yellow';
}

function fmt(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('th-TH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface Props {
  applicationId: string;
}

export function ActivitiesTabPanel({ applicationId }: Props) {
  const { dict } = useLanguage();
  const [activities, setActivities] = useState<ApplicationActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // X2-FIX-C / H-6 — explicit fetch-error state.
  //
  // Before X2-FIX-C the catch / !success branches both fell through to
  // setActivities([]) with no UI feedback. A reviewer hitting this tab
  // during an API outage saw the identical "ยังไม่มี activity..." empty
  // state as an application that genuinely had no activity log, so the
  // outage was invisible. We now record the message and render a rose
  // error card with a retry button (pattern: X1-FIX-C
  // health/dashboard + health/notifications client-views).
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  const handleRetry = useCallback(() => {
    setRetryToken((t) => t + 1);
  }, []);

  useEffect(() => {
    let aborted = false;
    setIsLoading(true);
    setFetchError(null);
    apiClient
      .get<ApplicationActivity[]>(
        providerApiPaths.applicationActivities(applicationId).replace(/^\/api\//, ''),
      )
      .then((res) => {
        if (aborted) return;
        if (res.success && Array.isArray(res.data)) {
          setActivities(res.data);
        } else {
          setFetchError(res.error || dict.common?.fetchError?.hint || 'Unable to load activities');
          setActivities([]);
        }
      })
      .catch((err: unknown) => {
        if (aborted) return;
        const message = err instanceof Error && err.message
          ? err.message
          : (dict.common?.fetchError?.hint || 'Unable to load activities');
        setFetchError(message);
        setActivities([]);
      })
      .finally(() => {
        if (!aborted) setIsLoading(false);
      });
    return () => {
      aborted = true;
    };
    // dict is captured at render time; retryToken drives manual re-fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, retryToken]);

  if (isLoading) {
    return (
      <Card className="rounded-lg border-border bg-card p-12 text-center shadow-none">
        <Spinner />
      </Card>
    );
  }

  // X2-FIX-C / H-6 — surface fetch errors distinctly from the empty
  // state so reviewers can retry instead of assuming the application
  // has no activity log.
  if (fetchError) {
    return (
      <Card
        data-testid="activities-fetch-error"
        className="rounded-lg border-destructive/40 bg-destructive/5 p-8 text-center shadow-none"
        role="alert"
        aria-live="polite"
      >
        <AlertCircle className="mx-auto mb-3 h-6 w-6 text-destructive" aria-hidden="true" focusable="false" />
        <h3 className="text-sm font-medium text-foreground">
          {dict.common?.fetchError?.title || 'Unable to load data'}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{fetchError}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={handleRetry}
        >
          {dict.common?.fetchError?.retry || 'Try again'}
        </Button>
      </Card>
    );
  }

  if (activities.length === 0) {
    return (
      <Card className="rounded-lg border-border bg-card p-12 text-center shadow-none">
        <p className="font-medium italic text-muted-foreground">
          ยังไม่มี activity สำหรับคำขอนี้ งานจะถูกสร้างอัตโนมัติเมื่อสถานะคำขอเปลี่ยน
        </p>
      </Card>
    );
  }

  // Split into open and closed for visual hierarchy
  const open = activities.filter((a) => ['TODO', 'CLAIMED', 'IN_PROGRESS'].includes(a.state));
  const closed = activities.filter((a) => ['DONE', 'CANCELLED'].includes(a.state));

  return (
    <div className="space-y-6">
      {open.length > 0 ? (
        <Card className="rounded-lg border-border bg-card p-6 shadow-none">
          <h3 className="mb-4 text-sm font-medium text-foreground">
            งานที่เปิดอยู่ ({open.length})
          </h3>
          <div className="space-y-2">
            {open.map((a) => (
              <ActivityRow key={a.id} activity={a} />
            ))}
          </div>
        </Card>
      ) : null}

      {closed.length > 0 ? (
        <Card className="rounded-lg border-border bg-card p-6 shadow-none">
          <h3 className="mb-4 text-sm font-medium text-foreground">
            ประวัติงาน ({closed.length})
          </h3>
          <div className="space-y-2">
            {closed.map((a) => (
              <ActivityRow key={a.id} activity={a} />
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function ActivityRow({ activity: a }: { activity: ApplicationActivity }) {
  const StateIcon =
    a.state === 'DONE' ? CheckCircle2 :
    a.state === 'CANCELLED' ? XCircle :
    a.assignedUserId ? Hand :
    UserMinus;

  return (
    <Link
      href={`/provider/work/${a.id}`}
      className="block rounded-lg border bg-background p-4 transition-colors hover:bg-muted/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <StateIcon size={14} className="text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              {WORK_TYPE_LABEL[a.workType] || a.workType}
            </span>
            <Badge color={stateBadgeColor(a.state, a.isOverdue)}>
              {a.isOverdue && !['DONE', 'CANCELLED'].includes(a.state)
                ? `เลย SLA · ${STATE_LABEL[a.state]}`
                : STATE_LABEL[a.state]}
            </Badge>
            <span className="text-xs text-muted-foreground">{a.candidateGroup}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock size={12} /> สร้างเมื่อ {fmt(a.createdAt)}
            </span>
            {a.dueAt ? <span>· ครบกำหนด {fmt(a.dueAt)}</span> : null}
            {a.assignedUserName ? <span>· รับโดย {a.assignedUserName}</span> : null}
            {a.completedByName ? <span>· ปิดโดย {a.completedByName}</span> : null}
          </div>
          {a.cancelReason ? (
            <p className="text-xs italic text-muted-foreground">เหตุผล: {a.cancelReason}</p>
          ) : null}
          {a.note ? <p className="text-xs italic text-muted-foreground">บันทึก: {a.note}</p> : null}
        </div>
        <ExternalLink size={14} className="mt-1 shrink-0 text-muted-foreground" />
      </div>
    </Link>
  );
}
