import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { IconExternalLink, IconVideo } from '@tabler/icons-react';
import type { AuditorQueueItem } from './provider-audit-job-sheet-config';

interface OnlineAuditControlProps {
    queueItem: AuditorQueueItem | null;
    auditStartTime: number | null;
    auditDuration: string;
    liveNotes: string;
    setLiveNotes: (val: string) => void;
    startAuditTimer: () => void;
    stopAuditTimer: () => void;
}

export function OnlineAuditControl({
    queueItem,
    auditStartTime,
    auditDuration,
    liveNotes,
    setLiveNotes,
    startAuditTimer,
    stopAuditTimer
}: OnlineAuditControlProps) {
    return (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/20">
            <div className="mb-3 flex items-center gap-2">
                <IconVideo size={18} className="text-blue-600" aria-hidden="true" />
                <p className="text-sm font-bold">ศูนย์ควบคุมการตรวจออนไลน์</p>
                {auditStartTime && (
                    <Badge color="red" className="animate-pulse"><span aria-hidden="true">●</span> REC {auditDuration}</Badge>
                )}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                    {queueItem?.meetingLink && (
                        <Button
                            component="a"
                            href={queueItem.meetingLink}
                            target="_blank"
                            leftSection={<IconVideo size={16} aria-hidden="true" />}
                            rightSection={<IconExternalLink size={12} aria-hidden="true" />}
                            color="blue"
                            className="w-full"
                        >
                            เข้าสู่ห้องประชุมออนไลน์
                        </Button>
                    )}
                    <div className="flex gap-2">
                        {!auditStartTime ? (
                            <Button color="teal" variant="outline" className="w-full" onClick={startAuditTimer}>
                                <span aria-hidden="true">▶</span> เริ่มบันทึกการตรวจ
                            </Button>
                        ) : (
                            <Button color="red" variant="outline" className="w-full" onClick={stopAuditTimer}>
                                <span aria-hidden="true">⏹</span> หยุดบันทึก ({auditDuration})
                            </Button>
                        )}
                    </div>
                </div>
                <div>
                    <p className="mb-1 text-xs text-slate-500"><span aria-hidden="true">📝</span> บันทึกระหว่างสนทนา (Live Notes)</p>
                    {/* Wave E.2 audit fix: was raw `px-3 py-2 rounded-md border-slate-200`
                        which drifted from the design system. Switched to the canonical
                        `.field-surface` utility (rounded-2xl + design-token bg + shadow-sm)
                        so this textarea matches every other form field in the app. */}
                    <textarea
                        className="field-surface w-full resize-none px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                        rows={3}
                        placeholder="จดบันทึกประเด็นสำคัญระหว่างการสนทนา..."
                        value={liveNotes}
                        onChange={(e) => setLiveNotes(e.target.value)}
                    />
                </div>
            </div>
        </div>
    );
}
