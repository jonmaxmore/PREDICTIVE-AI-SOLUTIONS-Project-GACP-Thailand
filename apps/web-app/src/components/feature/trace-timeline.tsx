import { Badge } from '@/components/ui/primitives/badge';
import { EmptyState } from '@/components/feature/empty-state';

interface TraceTimelineItem {
  id: string;
  event: string;
  actor: string;
  occurredAt: string;
  evidenceCount: number;
}

interface TraceTimelineProps {
  items: TraceTimelineItem[];
}

export function TraceTimeline({ items }: TraceTimelineProps) {
  if (items.length === 0) {
    return <EmptyState title="ยังไม่มีเหตุการณ์ trace" hint="ระบบจะแสดงบันทึกเมื่อมีการตรวจหรือออกเอกสาร" />;
  }

  return (
    <ol className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="rounded-2xl bg-muted/35 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-foreground">{item.event}</p>
            <Badge tone="primary">หลักฐาน {item.evidenceCount}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            โดย {item.actor} - {item.occurredAt}
          </p>
        </li>
      ))}
    </ol>
  );
}

