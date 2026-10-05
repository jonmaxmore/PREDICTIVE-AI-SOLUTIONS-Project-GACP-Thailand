'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Megaphone,
  RefreshCcw,
  Send,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api/api-client';
import { SummaryHeader } from '@/components/feature';
import { ADMIN_ROLE_OPTIONS } from '@/lib/constants/admin-role-options';

interface BroadcastLog {
  id: string;
  subject: string;
  message: string;
  sentAt: string | null;
  targetType: string;
  targetValue: string | null;
}

/**
 * X5-FIX-A / H-6 (V5-A finish): broadcast target options now derive
 * from `ADMIN_ROLE_OPTIONS` (canonical role source) so the dropdown
 * automatically picks up Tier 16 ACCOUNT_DTAM + ACCOUNT_PLATFORM
 * without a per-page edit. The static entries (ผู้ใช้ทั้งหมด /
 * userType:health / userType:provider) bookend the role-derived list.
 * SYSTEM is filtered out (it is a webhook actor, not a notification
 * recipient).
 */
const TARGET_OPTIONS = [
  { value: '', label: 'ผู้ใช้ทั้งหมด' },
  ...ADMIN_ROLE_OPTIONS
    .filter((option) => !option.hidden && option.canonical !== 'health')
    .map((option) => ({
      value: `role:${option.canonical}`,
      label: `${option.label} (${option.value})`,
    })),
  { value: 'userType:health', label: 'ผู้ยื่นคำขอ (Applicants)' },
  { value: 'userType:provider', label: 'เจ้าหน้าที่ทั้งหมด (Providers)' },
];

export default function AdminCommunicationPage() {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [target, setTarget] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [logs, setLogs] = useState<BroadcastLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const res = await apiClient.get<BroadcastLog[]>('/provider/admin/communication-log');
      if (res.success && Array.isArray(res.data)) {
        setLogs(res.data);
      }
    } catch { /* no-op */ }
    setLogsLoading(false);
  }, []);

  useEffect(() => { void loadLogs(); }, [loadLogs]);

  const send = async () => {
    if (!subject.trim() || !message.trim()) return;
    setSubmitting(true);
    setResult(null);

    const payload: Record<string, string> = {
      subject: subject.trim(),
      message: message.trim(),
    };
    if (target) {
      const [type, value] = target.split(':');
      if (type) payload.targetType = type;
      if (value) payload.targetValue = value;
    }

    try {
      const res = await apiClient.post<{ recipientCount?: number }>('/provider/admin/broadcast', payload);
      setResult({
        success: res.success,
        message: res.message || (res.success ? `ส่งสำเร็จ (${res.data?.recipientCount || 0} ผู้รับ)` : 'เกิดข้อผิดพลาด'),
      });
      if (res.success) {
        setSubject('');
        setMessage('');
        setTarget('');
        void loadLogs();
      }
    } catch {
      setResult({ success: false, message: 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์' });
    }
    setSubmitting(false);
  };

  return (
    // Wave E.2-B (batch 8): SummaryHeader replaces inline h2+p.
    <div className="space-y-6">
      {/* X5-FIX-B H-11: gov-gradient brand cue on ADMIN header. */}
      <SummaryHeader
        eyebrow="ผู้ให้บริการ · การสื่อสาร"
        title="ศูนย์การสื่อสาร"
        description="ศูนย์สื่อสาร ส่งประกาศและการแจ้งเตือนถึงผู้ใช้ในระบบ"
        className="gov-gradient border-none shadow-xl shadow-primary/20"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Compose */}
        <Card className="rounded-2xl border-border shadow-sm">
          <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
            <CardTitle className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
              <Send className="h-4 w-4 text-primary" />
              ส่งประกาศ (Broadcast)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="space-y-4">
              <div>
                <label htmlFor="broadcast-target" className="mb-1.5 block text-xs font-bold text-foreground">
                  กลุ่มเป้าหมาย
                </label>
                <select
                  id="broadcast-target"
                  title="เลือกกลุ่มเป้าหมาย"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  {TARGET_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="broadcast-subject" className="mb-1.5 block text-xs font-bold text-foreground">
                  หัวข้อ <span className="text-red-500">*</span>
                </label>
                <input
                  id="broadcast-subject"
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="หัวข้อประกาศ"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label htmlFor="broadcast-message" className="mb-1.5 block text-xs font-bold text-foreground">
                  ข้อความ <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="broadcast-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="พิมพ์ข้อความที่ต้องการส่ง..."
                  rows={5}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                />
              </div>

              <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                <p className="flex items-center gap-1.5 font-bold">
                  <AlertTriangle className="h-3.5 w-3.5" /> ข้อควรระวัง
                </p>
                <p className="mt-1">ข้อความจะถูกส่งเป็นการแจ้งเตือนในระบบไปยังผู้ใช้ที่เลือก ไม่สามารถยกเลิกได้</p>
              </div>

              {result && (
                <div className={cn('rounded-xl p-3 text-sm font-bold', result.success ? 'bg-leaf-soft text-leaf-onSoft' : 'bg-red-50 text-red-700')}>
                  {result.success ? <CheckCircle2 className="mr-2 inline h-4 w-4" /> : <AlertTriangle className="mr-2 inline h-4 w-4" />}
                  {result.message}
                </div>
              )}

              <Button
                onClick={send}
                disabled={submitting || !subject.trim() || !message.trim()}
                className="w-full rounded-xl font-bold"
              >
                {submitting ? <RefreshCcw className="mr-2 h-4 w-4 animate-spin" /> : <Megaphone className="mr-2 h-4 w-4" />}
                ส่งประกาศ
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Log */}
        <Card className="rounded-2xl border-border shadow-sm">
          <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
            <CardTitle className="flex items-center justify-between text-sm font-black text-muted-foreground">
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                ประวัติการส่ง
              </span>
              <Button variant="ghost" size="sm" onClick={loadLogs} aria-label="รีเฟรชประวัติการส่ง" className="h-7 min-h-[44px] min-w-[44px] rounded-lg px-2 sm:min-h-0 sm:min-w-0">
                <RefreshCcw className={cn('h-3.5 w-3.5', logsLoading && 'animate-spin')} aria-hidden="true" />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {logsLoading ? (
              <div className="flex justify-center py-8">
                <Spinner size="md" />
              </div>
            ) : logs.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">ยังไม่มีประวัติการส่งประกาศ</p>
            ) : (
              <div className="space-y-3">
                {logs.map((log) => (
                  <div key={log.id} className="rounded-xl border border-border p-3 transition-all duration-200 hover:shadow-md sm:p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-foreground">{log.subject}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{log.message}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5">
                        <Users className="h-3 w-3 text-primary" />
                        <span className="text-[10px] font-bold text-primary">
                          {log.targetType === 'all' ? 'ทั้งหมด' : log.targetValue || log.targetType}
                        </span>
                      </div>
                    </div>
                    {log.sentAt && (
                      <p className="mt-2 text-[10px] text-muted-foreground/60">
                        {new Date(log.sentAt).toLocaleString('th-TH')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
