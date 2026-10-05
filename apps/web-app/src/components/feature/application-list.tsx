import { ApplicationRow } from '@/components/feature/application-row';
import { EmptyState } from '@/components/feature/empty-state';

interface ApplicationListItem {
  id: string;
  code: string;
  farmName: string;
  stage: string;
  stageLabel: string;
  dateLabel: string;
  actionLabel: string;
  actionHref: string;
}

interface ApplicationListProps {
  loading: boolean;
  items: ApplicationListItem[];
  emptyTitle: string;
  emptyHint: string;
}

export function ApplicationList({ loading, items, emptyTitle, emptyHint }: ApplicationListProps) {
  if (loading) {
    return (
      <div className="cluster-list">
        {[0, 1, 2].map((skeleton) => (
          <div key={skeleton} className="h-20 animate-pulse rounded-lg bg-muted/55" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return <EmptyState title={emptyTitle} hint={emptyHint} />;
  }

  return (
    <div className="cluster-list">
      <div className="hidden rounded-lg bg-muted/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1.35fr)_minmax(0,0.75fr)_auto]">
        <span>ข้อมูลคำขอ</span>
        <span className="text-center">สถานะ</span>
        <span className="text-right">ดำเนินการ</span>
      </div>

      {items.map((item) => (
        <ApplicationRow key={item.id} {...item} />
      ))}
    </div>
  );
}
