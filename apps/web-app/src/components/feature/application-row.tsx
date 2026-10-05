import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { StatusBadge } from '@/components/ui/primitives/status-badge';

const stageDotColor: Record<string, string> = {
  DRAFT: 'bg-slate-400',
  WAITING_DOCUMENT_REVIEW: 'bg-blue-500',
  WAITING_PAYMENT: 'bg-amber-500',
  WAITING_AUDIT: 'bg-orange-500',
  CERTIFIED: 'bg-leaf-600',
  // 8-stage model
  PENDING_FEE_PHASE1: 'bg-orange-400',
  UNDER_DOCUMENT_REVIEW: 'bg-amber-500',
  REVISION_REQUIRED: 'bg-red-500',
  PENDING_FEE_PHASE2: 'bg-orange-500',
  UNDER_FIELD_AUDIT: 'bg-blue-500',
  APPROVED: 'bg-teal-500',
};

interface ApplicationRowProps {
  id: string;
  code: string;
  farmName: string;
  stage: string;
  stageLabel: string;
  dateLabel: string;
  actionLabel: string;
  actionHref: string;
}

export function ApplicationRow({ id, code, farmName, stage, stageLabel, dateLabel, actionLabel, actionHref }: ApplicationRowProps) {
  const dot = stageDotColor[stage] || 'bg-muted-foreground';

  return (
    <article className="activity-row group-item-hover group grid gap-3 transition-all duration-200 hover:-translate-y-px hover:shadow-sm sm:grid-cols-[minmax(0,1.35fr)_minmax(0,0.75fr)_auto] sm:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden />
        <div className="min-w-0 space-y-0.5">
          <p className="truncate text-sm font-semibold text-foreground">{code}</p>
          <p className="truncate text-xs text-muted-foreground">ฟาร์ม: {farmName}</p>
          <p className="text-xs text-muted-foreground">{dateLabel}</p>
        </div>
      </div>

      <div className="flex items-center justify-start sm:justify-center">
        <StatusBadge status={stage} label={stageLabel} />
      </div>

      <Link
        href={actionHref}
        className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground no-underline transition-all hover:gap-2.5 hover:bg-primary/90"
        aria-label={`ทำรายการ ${id}`}
      >
        {actionLabel}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </article>
  );
}
