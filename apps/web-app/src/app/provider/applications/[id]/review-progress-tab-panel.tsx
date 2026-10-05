import { AlertTriangle, CheckCircle2, ClipboardCheck, GitCompareArrows, PenLine } from "lucide-react";
import { Badge } from '@/components/ui/primitives/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { useLanguage } from '@/lib/i18n/language-context';

// The 9 GACP application sections a document reviewer covers. Rendered as a
// REFERENCE checklist (guidance for what to review) — the per-step "verified"
// gate (REV-12) was dropped 2026-06-23 (owner decision, pilot-simplify): the
// step-marking UI was never wired, and review is a holistic approve /
// request-revision decision. The sections are kept here as a reviewer aid.
export function ReviewProgressTabPanel({
  revisionRequest,
  revisionCountdown,
  resubmissionChanges,
}: {
  revisionRequest: Record<string, unknown> | null;
  revisionCountdown: { color: string; label: string; } | null;
  resubmissionChanges: { field: string; modifiedAt: string }[];
}) {
  const { dict } = useLanguage();
  const progressDict = dict.provider?.reviewProgress;
  const labels = progressDict?.stepLabels;
  const REVIEW_STEPS = [
    { number: 1, label: labels?.step1 || 'ข้อมูลผู้ยื่นคำขอ' },
    { number: 2, label: labels?.step2 || 'ข้อมูลแปลงปลูก' },
    { number: 3, label: labels?.step3 || 'ข้อมูลการเพาะปลูก' },
    { number: 4, label: labels?.step4 || 'ผลตรวจดินและน้ำ' },
    { number: 5, label: labels?.step5 || 'การจัดการศัตรูพืช' },
    { number: 6, label: labels?.step6 || 'การเก็บเกี่ยว' },
    { number: 7, label: labels?.step7 || 'การตากผึ่ง/อบแห้ง' },
    { number: 8, label: labels?.step8 || 'การเก็บรักษา' },
    { number: 9, label: labels?.step9 || 'เอกสารประกอบ' },
  ];
  return (
    <>
      {revisionRequest && (
        <Card className="rounded-lg border-warning/40 bg-warning/10 p-5 shadow-none">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-foreground">{progressDict?.revisionTitle || 'Revision Requested'} — {String(revisionRequest.category || 'GENERAL')}</h4>
              <p className="text-sm text-muted-foreground">{String(revisionRequest.message || '')}</p>
              {revisionCountdown && (
                <Badge tone={revisionCountdown.color === 'red' ? 'danger' : 'neutral'} className="rounded-md">
                  {revisionCountdown.label}
                </Badge>
              )}
              {Array.isArray(revisionRequest.items) && revisionRequest.items.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {revisionRequest.items.map((item: string, idx: number) => (
                    <li key={idx} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <PenLine className="h-3 w-3" />
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}

      {resubmissionChanges.length > 0 && (
        <Card className="rounded-lg border-info/40 bg-info/10 p-5 shadow-none">
          <div className="mb-4 flex items-center gap-2">
            <GitCompareArrows className="h-5 w-5 shrink-0 text-info" aria-hidden="true" />
            <h4 className="text-sm font-medium text-foreground">{progressDict?.changesDetected || 'ฟิลด์ที่แก้ไขแล้ว (Changes Detected)'}</h4>
          </div>
          <div className="divide-y divide-border/60 border-t border-border/60">
            {resubmissionChanges.map((change, idx) => (
              <div key={idx} className="flex items-center gap-3 py-2.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-leaf-700" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium text-foreground">{change.field}</p>
                  <p className="text-xs text-muted-foreground">{progressDict?.editedAt || 'แก้ไขเมื่อ'} {change.modifiedAt || '-'}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="rounded-lg border-border bg-card shadow-none">
        <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
            <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
            {'หมวดเอกสารที่ต้องตรวจ (9 หมวด)'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {REVIEW_STEPS.map((step) => (
              <div key={step.number} className="flex items-baseline gap-2 py-1">
                <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">{step.number}.</span>
                <span className="text-sm text-foreground">{step.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
