import { Clock3 } from 'lucide-react';
import { EmptyState } from '@/components/feature/empty-state';

interface TimelineItem {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  actor?: string;
}

interface ActivityTimelineProps {
  items: TimelineItem[];
  emptyTitle?: string;
  emptyHint?: string;
}

export function ActivityTimeline({
  items,
  emptyTitle = 'ยังไม่มีบันทึกกิจกรรม',
  emptyHint = 'เมื่อมีการทำรายการใหม่ จะแสดงที่นี่ทันที',
}: ActivityTimelineProps) {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} hint={emptyHint} />;
  }

  return (
    <ol className="cluster-list">
      {items.map((item) => (
        <li key={item.id} className="activity-row group-item-hover">
          <div className="flex items-start gap-3">
            <span className="mt-1.5 inline-block h-2.5 w-2.5 rounded-full bg-primary/90" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">{item.title}</p>
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" />
                  {item.timestamp}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
              {item.actor ? <p className="mt-1 text-xs text-muted-foreground">ผู้ดำเนินการ: {item.actor}</p> : null}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
