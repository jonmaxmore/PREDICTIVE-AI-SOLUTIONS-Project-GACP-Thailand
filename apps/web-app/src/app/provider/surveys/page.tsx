'use client';

/**
 * สัญญา C05F680149 ต้นแบบที่ 2 — "ต้นแบบระบบสำรวจความต้องการ (1 ชุด)"
 * หน้าจัดการแบบสำรวจ (master data): สร้าง (ADMIN) → เปิดรับคำตอบ → ปิด
 * ตาม ERP document pattern (DRAFT→ACTIVE→CLOSED).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { notifications } from '@/lib/notifications';
import { apiClient } from '@/lib/api/api-client';
import ProviderLayout from '../components/provider-layout';

interface SurveyTemplate {
  id: string;
  code: string;
  title: string;
  targetGroup: string;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED';
  createdAt?: string;
  questions?: { id: string }[];
}

interface DraftQuestion {
  questionText: string;
  questionType: string;
  choicesText: string;
  isRequired: boolean;
}

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-200',
  ACTIVE: 'bg-leaf-soft text-leaf-onSoft border-leaf-300',
  CLOSED: 'bg-amber-100 text-amber-800 border-amber-200',
};

const TARGET_OPTIONS = [
  { value: 'FARMER', label: 'เกษตรกร' },
  { value: 'EXPERT', label: 'ผู้เชี่ยวชาญ' },
  { value: 'DTAM_STAFF', label: 'เจ้าหน้าที่กรมฯ' },
  { value: 'OPERATOR', label: 'ผู้ประกอบการ' },
];

const TYPE_OPTIONS = [
  { value: 'TEXT', label: 'ข้อความสั้น' },
  { value: 'TEXTAREA', label: 'ข้อความยาว' },
  { value: 'RATING_5', label: 'คะแนน 1-5' },
  { value: 'SINGLE_CHOICE', label: 'เลือกข้อเดียว' },
  { value: 'MULTI_CHOICE', label: 'เลือกหลายข้อ' },
  { value: 'NUMBER', label: 'ตัวเลข' },
];

const emptyQuestion = (): DraftQuestion => ({
  questionText: '',
  questionType: 'TEXT',
  choicesText: '',
  isRequired: true,
});

export default function ProviderSurveysPage() {
  const [templates, setTemplates] = useState<SurveyTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [targetGroup, setTargetGroup] = useState('FARMER');
  const [questions, setQuestions] = useState<DraftQuestion[]>([emptyQuestion()]);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await apiClient.get<SurveyTemplate[]>('/api/surveys/templates');
      if (res.success && Array.isArray(res.data)) {
        setTemplates(res.data);
      }
    } catch {
      notifications.show({ title: 'เกิดข้อผิดพลาด', message: 'โหลดรายการแบบสำรวจไม่สำเร็จ', color: 'red' });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateQuestion = (index: number, patch: Partial<DraftQuestion>) => {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  };

  const createTemplate = async () => {
    setFormError(null);
    const payloadQuestions = questions
      .filter((q) => q.questionText.trim() !== '')
      .map((q) => ({
        questionText: q.questionText.trim(),
        questionType: q.questionType,
        isRequired: q.isRequired,
        ...(q.questionType.endsWith('_CHOICE')
          ? { choices: q.choicesText.split(',').map((c) => c.trim()).filter(Boolean) }
          : {}),
      }));

    if (!code.trim() || !title.trim() || payloadQuestions.length === 0) {
      setFormError('กรอกรหัส ชื่อแบบสำรวจ และคำถามอย่างน้อย 1 ข้อ');
      return;
    }

    setIsSaving(true);
    try {
      const res = await apiClient.post('/api/surveys/templates', {
        code: code.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        targetGroup,
        questions: payloadQuestions,
      });
      if (res.success) {
        notifications.show({ title: 'สำเร็จ', message: 'สร้างแบบสำรวจแล้ว (สถานะ DRAFT กดเปิดรับคำตอบเมื่อพร้อม)', color: 'green' });
        setIsDialogOpen(false);
        setCode('');
        setTitle('');
        setDescription('');
        setQuestions([emptyQuestion()]);
        void load();
      } else {
        setFormError('สร้างไม่สำเร็จ ตรวจสอบข้อมูล (รหัสเป็น A-Z/0-9/-/_ และคำถามแบบตัวเลือกต้องมี ≥2 ตัวเลือก)');
      }
    } catch {
      setFormError('สร้างไม่สำเร็จ ตรวจสอบสิทธิ์ (เฉพาะ ADMIN) และข้อมูลที่กรอก');
    } finally {
      setIsSaving(false);
    }
  };

  const transition = async (id: string, action: 'activate' | 'close') => {
    try {
      const res = await apiClient.post(`/api/surveys/templates/${id}/${action}`, {});
      if (res.success) {
        notifications.show({
          title: 'สำเร็จ',
          message: action === 'activate' ? 'เปิดรับคำตอบแล้ว' : 'ปิดแบบสำรวจแล้ว',
          color: 'green',
        });
        void load();
      } else {
        notifications.show({ title: 'เกิดข้อผิดพลาด', message: 'เปลี่ยนสถานะไม่สำเร็จ', color: 'red' });
      }
    } catch {
      notifications.show({ title: 'เกิดข้อผิดพลาด', message: 'เปลี่ยนสถานะไม่สำเร็จ (เฉพาะ ADMIN)', color: 'red' });
    }
  };

  return (
    <ProviderLayout heading title="ต้นแบบระบบสำรวจความต้องการ" subtitle="Needs Survey System · THRSP ต้นแบบที่ 2">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            แบบสอบถามดิจิทัลครอบคลุม 4 ภาค + บันทึกการสัมภาษณ์ผู้เชี่ยวชาญ {' '}
            <Link href="/provider/surveys/interviews" className="text-primary underline underline-offset-2">
              ไปหน้าบันทึกสัมภาษณ์
            </Link>
          </p>
          <Button onClick={() => setIsDialogOpen(true)}>
            <Plus className="mr-1 size-4" /> สร้างแบบสำรวจ
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : (
          <>
            {/* Desktop: table (≥ md) */}
            <div className="hidden overflow-x-auto rounded-lg border border-border bg-card md:block">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left">
                    <th className="px-4 py-3 font-medium">รหัส</th>
                    <th className="px-4 py-3 font-medium">ชื่อแบบสำรวจ</th>
                    <th className="px-4 py-3 font-medium">กลุ่มเป้าหมาย</th>
                    <th className="px-4 py-3 font-medium">คำถาม</th>
                    <th className="px-4 py-3 font-medium">สถานะ</th>
                    <th className="px-4 py-3 font-medium">การจัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {templates.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        ยังไม่มีแบบสำรวจ กด &quot;สร้างแบบสำรวจ&quot; เพื่อเริ่ม
                      </td>
                    </tr>
                  ) : (
                    templates.map((template) => (
                      <tr key={template.id}>
                        <td className="px-4 py-3 font-mono text-xs">{template.code}</td>
                        <td className="px-4 py-3">
                          <Link href={`/provider/surveys/${template.id}`} className="font-medium text-primary hover:underline">
                            {template.title}
                          </Link>
                        </td>
                        <td className="px-4 py-3">{TARGET_OPTIONS.find(t => t.value === template.targetGroup)?.label ?? template.targetGroup}</td>
                        <td className="px-4 py-3">{template.questions?.length ?? 0}</td>
                        <td className="px-4 py-3">
                          <Badge className={STATUS_BADGE[template.status] ?? ''}>{template.status}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          {template.status === 'DRAFT' ? (
                            <Button size="sm" onClick={() => void transition(template.id, 'activate')}>เปิดรับคำตอบ</Button>
                          ) : null}
                          {template.status === 'ACTIVE' ? (
                            <Button size="sm" variant="outline" onClick={() => void transition(template.id, 'close')}>ปิดแบบสำรวจ</Button>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile: card stack (< md) — no horizontal scroll */}
            {templates.length === 0 ? (
              <div className="rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground md:hidden">
                ยังไม่มีแบบสำรวจ กด &quot;สร้างแบบสำรวจ&quot; เพื่อเริ่ม
              </div>
            ) : (
              <ul className="space-y-3 md:hidden">
                {templates.map((template) => (
                  <li key={template.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <Link href={`/provider/surveys/${template.id}`} className="font-medium text-primary hover:underline">
                        {template.title}
                      </Link>
                      <Badge className={`shrink-0 ${STATUS_BADGE[template.status] ?? ''}`}>{template.status}</Badge>
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">{template.code}</p>
                    <p className="mt-1 text-sm">
                      {TARGET_OPTIONS.find(t => t.value === template.targetGroup)?.label ?? template.targetGroup}
                      <span className="text-muted-foreground"> · {template.questions?.length ?? 0} คำถาม</span>
                    </p>
                    {template.status === 'DRAFT' ? (
                      <Button size="sm" className="mt-3 w-full" onClick={() => void transition(template.id, 'activate')}>เปิดรับคำตอบ</Button>
                    ) : null}
                    {template.status === 'ACTIVE' ? (
                      <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => void transition(template.id, 'close')}>ปิดแบบสำรวจ</Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>สร้างแบบสำรวจใหม่</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium">รหัส (A-Z, 0-9, -, _)</span>
                  <input
                    type="text"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="FARMER-NEEDS-2569"
                  />
                </label>
                <Select
                  label="กลุ่มเป้าหมาย"
                  value={targetGroup}
                  onChange={(value) => setTargetGroup(value || 'FARMER')}
                  data={TARGET_OPTIONS}
                />
              </div>
              <label className="block">
                <span className="mb-1 block text-sm font-medium">ชื่อแบบสำรวจ</span>
                <input
                  type="text"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="แบบสำรวจความต้องการเกษตรกรผู้ปลูกสมุนไพร 4 ภาค"
                />
              </label>
              <label className="block" htmlFor="survey-description">
                <span className="mb-1 block text-sm font-medium">คำอธิบาย</span>
                <Textarea id="survey-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
              </label>

              <div className="space-y-3">
                <div className="text-sm font-medium">คำถาม</div>
                {questions.map((question, index) => (
                  <div key={index} className="rounded-xl border border-border p-3">
                    <div className="flex items-start gap-2">
                      <div className="grid grow grid-cols-1 gap-2 sm:grid-cols-2">
                        <input
                          type="text"
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm sm:col-span-2"
                          value={question.questionText}
                          onChange={(e) => updateQuestion(index, { questionText: e.target.value })}
                          placeholder={`คำถามที่ ${index + 1}`}
                        />
                        <Select
                          value={question.questionType}
                          onChange={(value) => updateQuestion(index, { questionType: value || 'TEXT' })}
                          data={TYPE_OPTIONS}
                        />
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={question.isRequired}
                            onChange={(e) => updateQuestion(index, { isRequired: e.target.checked })}
                          />
                          บังคับตอบ
                        </label>
                        {question.questionType.endsWith('_CHOICE') ? (
                          <input
                            type="text"
                            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm sm:col-span-2"
                            value={question.choicesText}
                            onChange={(e) => updateQuestion(index, { choicesText: e.target.value })}
                            placeholder="ตัวเลือก (คั่นด้วยจุลภาค) เช่น ตลาดสด, ออนไลน์, สหกรณ์"
                          />
                        ) : null}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setQuestions((prev) => prev.filter((_, i) => i !== index))}
                        disabled={questions.length === 1}
                        aria-label="ลบคำถาม"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setQuestions((prev) => [...prev, emptyQuestion()])}>
                  <Plus className="mr-1 size-4" /> เพิ่มคำถาม
                </Button>
              </div>

              {formError ? <Alert variant="error">{formError}</Alert> : null}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>ยกเลิก</Button>
                <Button onClick={() => void createTemplate()} disabled={isSaving}>
                  {isSaving ? 'กำลังบันทึก…' : 'บันทึก (DRAFT)'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ProviderLayout>
  );
}
