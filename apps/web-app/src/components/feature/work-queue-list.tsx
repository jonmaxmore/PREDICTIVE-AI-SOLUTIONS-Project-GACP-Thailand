'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/primitives/sheet';

interface QueueItem {
  id: string;
  applicationNumber: string;
  applicantName: string;
  stageLabel: string;
  priorityLabel: string;
  submittedDate: string;
  actionHref: string;
}

interface WorkQueueListProps {
  items: QueueItem[];
}

export function WorkQueueList({ items }: WorkQueueListProps) {
  const [selected, setSelected] = useState<QueueItem | null>(null);

  return (
    <>
      <div className="cluster-list">
        {items.map((item) => (
          <article key={item.id} className="group-item group-item-hover">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{item.applicationNumber}</p>
                <p className="text-xs text-muted-foreground">
                  {item.applicantName} - {item.submittedDate}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Badge tone="info">{item.stageLabel}</Badge>
                <Badge tone="warning">{item.priorityLabel}</Badge>
                <Button variant="secondary" size="sm" onClick={() => setSelected(item)}>
                  ดูงาน
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="w-[min(96vw,460px)]">
          {selected ? (
            <>
              <SheetHeader>
                <SheetTitle>รายละเอียดคำขอ {selected.applicationNumber}</SheetTitle>
                <SheetDescription>ตรวจข้อมูลหลักก่อนเข้าสู่หน้าปฏิบัติงานเต็มรูปแบบ</SheetDescription>
              </SheetHeader>

              <div className="cluster-list mt-6">
                <div className="group-item">
                  <p className="text-xs text-muted-foreground">ผู้ยื่นคำขอ</p>
                  <p className="text-sm font-semibold text-foreground">{selected.applicantName}</p>
                </div>
                <div className="group-item">
                  <p className="text-xs text-muted-foreground">สถานะปัจจุบัน</p>
                  <p className="text-sm font-semibold text-foreground">{selected.stageLabel}</p>
                </div>
                <div className="group-item">
                  <p className="text-xs text-muted-foreground">ความสำคัญ</p>
                  <p className="text-sm font-semibold text-foreground">{selected.priorityLabel}</p>
                </div>
                <Button asChild className="w-full">
                  <a href={selected.actionHref}>เปิดหน้าตรวจคำขอ</a>
                </Button>
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

