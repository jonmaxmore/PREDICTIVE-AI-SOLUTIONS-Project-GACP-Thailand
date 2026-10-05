'use client';

/**
 * บันทึกการสัมภาษณ์ผู้เชี่ยวชาญ — สัญญา C05F680149 ต้นแบบที่ 2.2
 * (ระบบสัมภาษณ์ผู้เชี่ยวชาญ semi-structured: บันทึก transcript + key insights;
 * เลขบัตรใน free text ถูก mask ฝั่ง backend ก่อนจัดเก็บ)
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus } from 'lucide-react';

import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { notifications } from '@/lib/notifications';
import { formatThaiDate } from '@/utils/thai-date';
import { apiClient } from '@/lib/api/api-client';
import ProviderLayout from '../../components/provider-layout';

interface ExpertInterview {
  id: string;
  title: string;
  intervieweeName: string;
  intervieweeOrg?: string | null;
  intervieweeRole?: string | null;
  interviewDate: string;
  mode: string;
  transcript: string;
  keyInsights?: string[] | null;
}

export default function ExpertInterviewsPage() {
  const [interviews, setInterviews] = useState<ExpertInterview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [intervieweeName, setIntervieweeName] = useState('');
  const [intervieweeOrg, setIntervieweeOrg] = useState('');
  const [intervieweeRole, setIntervieweeRole] = useState('');
  const [interviewDate, setInterviewDate] = useState('');
  const [mode, setMode] = useState('ONSITE');
  const [transcript, setTranscript] = useState('');
  const [insightsText, setInsightsText] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiClient.get<ExpertInterview[]>('/api/surveys/interviews');
      if (res.success && Array.isArray(res.data)) {
        setInterviews(res.data);
      }
    } catch {
      notifications.show({ title: 'เกิดข้อผิดพลาด', message: 'โหลดบันทึกสัมภาษณ์ไม่สำเร็จ', color: 'red' });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createInterview = async () => {
    setFormError(null);
    if (!title.trim() || !intervieweeName.trim() || !interviewDate || !transcript.trim()) {
      setFormError('กรอกหัวข้อ ชื่อผู้ให้สัมภาษณ์ วันที่ และบันทึกการสัมภาษณ์');
      return;
    }
    setIsSaving(true);
    try {
      const res = await apiClient.post('/api/surveys/interviews', {
        title: title.trim(),
        intervieweeName: intervieweeName.trim(),
        intervieweeOrg: intervieweeOrg.trim() || undefined,
        intervieweeRole: intervieweeRole.trim() || undefined,
        interviewDate,
        mode,
        transcript: transcript.trim(),
        keyInsights: insightsText.split('\n').map((s) => s.trim()).filter(Boolean),
      });
      if (res.success) {
        notifications.show({ title: 'สำเร็จ', message: 'บันทึกการสัมภาษณ์แล้ว', color: 'green' });
        setIsDialogOpen(false);
        setTitle('');
        setIntervieweeName('');
        setIntervieweeOrg('');
        setIntervieweeRole('');
        setInterviewDate('');
        setTranscript('');
        setInsightsText('');
        void load();
      } else {
        setFormError('บันทึกไม่สำเร็จ ตรวจสอบข้อมูล');
      }
    } catch {
      setFormError('บันทึกไม่สำเร็จ ตรวจสอบสิทธิ์ (เฉพาะ ADMIN) และข้อมูล');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ProviderLayout heading title="บันทึกการสัมภาษณ์ผู้เชี่ยวชาญ" subtitle="Expert Interviews · THRSP ต้นแบบที่ 2.2">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Link href="/provider/surveys" className="inline-flex items-center gap-1 text-sm text-primary hover:underline">
            <ArrowLeft className="size-4" /> กลับไปหน้าแบบสำรวจ
          </Link>
          <Button onClick={() => setIsDialogOpen(true)}>
            <Plus className="mr-1 size-4" /> บันทึกการสัมภาษณ์
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : interviews.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center text-muted-foreground">
            ยังไม่มีบันทึกการสัมภาษณ์
          </div>
        ) : (
          <div className="space-y-4">
            {interviews.map((interview) => (
              <div key={interview.id} className="rounded-lg border border-border bg-card p-4 md:p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{interview.title}</span>
                  <Badge tone="neutral">
                    {interview.mode === 'ONLINE' ? 'ออนไลน์' : 'พบหน้า'}
                  </Badge>
                  <span className="text-sm text-muted-foreground">{formatThaiDate(interview.interviewDate)}</span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {interview.intervieweeName}
                  {interview.intervieweeRole ? ` · ${interview.intervieweeRole}` : ''}
                  {interview.intervieweeOrg ? ` · ${interview.intervieweeOrg}` : ''}
                </p>
                {interview.keyInsights && interview.keyInsights.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {interview.keyInsights.map((insight, i) => (
                      <span key={i} className="rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
                        {insight}
                      </span>
                    ))}
                  </div>
                ) : null}
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-primary">ดูบันทึกการสัมภาษณ์</summary>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{interview.transcript}</p>
                </details>
              </div>
            ))}
          </div>
        )}

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>บันทึกการสัมภาษณ์ผู้เชี่ยวชาญ</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <label className="block">
                <span className="mb-1 block text-sm font-medium">หัวข้อ *</span>
                <input
                  type="text"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="สัมภาษณ์ความต้องการระบบ ทีมกรมการแพทย์แผนไทยฯ"
                />
              </label>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">ชื่อผู้ให้สัมภาษณ์ *</span>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    value={intervieweeName}
                    onChange={(e) => setIntervieweeName(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">ตำแหน่ง/บทบาท</span>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    value={intervieweeRole}
                    onChange={(e) => setIntervieweeRole(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">หน่วยงาน</span>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    value={intervieweeOrg}
                    onChange={(e) => setIntervieweeOrg(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">วันที่สัมภาษณ์ *</span>
                  <input
                    type="date"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    value={interviewDate}
                    onChange={(e) => setInterviewDate(e.target.value)}
                  />
                </label>
                <Select
                  label="รูปแบบ"
                  value={mode}
                  onChange={(value) => setMode(value || 'ONSITE')}
                  data={[
                    { value: 'ONSITE', label: 'พบหน้า' },
                    { value: 'ONLINE', label: 'ออนไลน์' },
                  ]}
                />
              </div>
              <label className="block" htmlFor="interview-transcript">
                <span className="mb-1 block text-sm font-medium">บันทึกการสัมภาษณ์ (transcript) *</span>
                <Textarea id="interview-transcript" value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={6} />
              </label>
              <label className="block" htmlFor="interview-insights">
                <span className="mb-1 block text-sm font-medium">Key Insights (บรรทัดละ 1 ข้อ)</span>
                <Textarea id="interview-insights" value={insightsText} onChange={(e) => setInsightsText(e.target.value)} rows={3} />
              </label>

              {formError ? <Alert variant="error">{formError}</Alert> : null}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>ยกเลิก</Button>
                <Button onClick={() => void createInterview()} disabled={isSaving}>
                  {isSaving ? 'กำลังบันทึก…' : 'บันทึก'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ProviderLayout>
  );
}
