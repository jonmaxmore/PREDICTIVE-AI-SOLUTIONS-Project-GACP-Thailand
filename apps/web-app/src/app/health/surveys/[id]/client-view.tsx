'use client';

/**
 * ฟอร์มตอบแบบสำรวจ — สัญญา C05F680149 ต้นแบบที่ 2 (แบบสอบถามดิจิทัล 4 ภาค).
 * BE validates authoritatively (required/type/region); this form mirrors the
 * rules for UX only. Response = posted document (immutable after submit).
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent } from '@/components/ui/primitives/card';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { apiClient } from '@/lib/api/api-client';

interface SurveyQuestion {
  id: string;
  sortOrder: number;
  section?: string | null;
  questionText: string;
  questionType: 'TEXT' | 'TEXTAREA' | 'RATING_5' | 'SINGLE_CHOICE' | 'MULTI_CHOICE' | 'NUMBER';
  choices?: string[] | null;
  isRequired: boolean;
}

interface SurveyTemplate {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  questions: SurveyQuestion[];
}

const REGION_OPTIONS = [
  { value: 'NORTH', label: 'ภาคเหนือ' },
  { value: 'CENTRAL', label: 'ภาคกลาง' },
  { value: 'NORTHEAST', label: 'ภาคตะวันออกเฉียงเหนือ' },
  { value: 'SOUTH', label: 'ภาคใต้' },
];

export default function ClientView() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [template, setTemplate] = useState<SurveyTemplate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [region, setRegion] = useState('');
  const [province, setProvince] = useState('');
  const [values, setValues] = useState<Record<string, string | number | string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        // Active-survey list is the applicant-visible source (no provider read needed)
        const res = await apiClient.get<SurveyTemplate[]>('/api/surveys/active');
        if (active && res.success && Array.isArray(res.data)) {
          setTemplate(res.data.find((t) => t.id === params.id) ?? null);
        }
      } catch {
        if (active) {
          setError('โหลดแบบสำรวจไม่สำเร็จ');
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [params.id]);

  const questions = useMemo(
    () => [...(template?.questions ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [template],
  );

  const setValue = (questionId: string, value: string | number | string[]) => {
    setValues((prev) => ({ ...prev, [questionId]: value }));
  };

  const toggleMulti = (questionId: string, choice: string) => {
    setValues((prev) => {
      const current = Array.isArray(prev[questionId]) ? (prev[questionId] as string[]) : [];
      const next = current.includes(choice)
        ? current.filter((c) => c !== choice)
        : [...current, choice];
      return { ...prev, [questionId]: next };
    });
  };

  const submit = async () => {
    if (!template) {
      return;
    }
    setError(null);
    if (!region) {
      setError('กรุณาเลือกภูมิภาคของท่าน');
      return;
    }
    const missing = questions.filter((q) => {
      const v = values[q.id];
      return q.isRequired && (v === undefined || v === '' || (Array.isArray(v) && v.length === 0));
    });
    if (missing.length > 0) {
      setError(`กรุณาตอบคำถามที่มีเครื่องหมาย * ให้ครบ (เหลืออีก ${missing.length} ข้อ)`);
      return;
    }

    setIsSubmitting(true);
    try {
      const answers = questions
        .filter((q) => values[q.id] !== undefined && values[q.id] !== '')
        .map((q) => ({ questionId: q.id, value: values[q.id] }));
      const res = await apiClient.post(`/api/surveys/templates/${template.id}/responses`, {
        region,
        province: province || undefined,
        answers,
      });
      if (res.success) {
        setSubmitted(true);
      } else {
        setError('ส่งคำตอบไม่สำเร็จ ลองใหม่อีกครั้ง');
      }
    } catch {
      setError('ส่งคำตอบไม่สำเร็จ ลองใหม่อีกครั้ง');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="mx-auto w-full px-4 py-16 text-center md:px-6">
        <CheckCircle2 className="mx-auto size-12 text-leaf-700" />
        <h1 className="mt-4 text-xl font-semibold">ขอบคุณสำหรับคำตอบของท่าน</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          ข้อมูลของท่านจะถูกใช้พัฒนาระบบและบริการสำหรับเกษตรกรผู้ปลูกสมุนไพร
        </p>
        <Button className="mt-6" onClick={() => router.push('/health/surveys')}>
          กลับไปหน้าแบบสำรวจ
        </Button>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="mx-auto w-full px-4 py-10 md:px-6">
        <Alert variant="error">ไม่พบแบบสำรวจนี้ หรือแบบสำรวจปิดรับคำตอบแล้ว</Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full px-4 py-6 md:px-6">
      <h1 className="text-xl font-semibold">{template.title}</h1>
      {template.description ? (
        <p className="mt-1 text-sm text-muted-foreground">{template.description}</p>
      ) : null}

      <Card className="mt-6">
        <CardContent className="space-y-4 p-4 md:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="ภูมิภาคของท่าน *"
              placeholder="เลือกภูมิภาค"
              value={region}
              onChange={(value) => setRegion(value || '')}
              data={REGION_OPTIONS}
            />
            <label className="block">
              <span className="mb-1 block text-sm font-medium">จังหวัด</span>
              <input
                type="text"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                value={province}
                onChange={(e) => setProvince(e.target.value)}
                placeholder="เช่น เชียงใหม่"
              />
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 space-y-4">
        {questions.map((question, index) => (
          <Card key={question.id}>
            <CardContent className="p-4 md:p-6">
              <div className="font-medium">
                {index + 1}. {question.questionText}
                {question.isRequired ? <span className="text-red-600"> *</span> : null}
              </div>

              <div className="mt-3">
                {question.questionType === 'TEXT' ? (
                  <input
                    type="text"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    value={(values[question.id] as string) ?? ''}
                    onChange={(e) => setValue(question.id, e.target.value)}
                  />
                ) : null}

                {question.questionType === 'TEXTAREA' ? (
                  <Textarea
                    value={(values[question.id] as string) ?? ''}
                    onChange={(e) => setValue(question.id, e.target.value)}
                    rows={3}
                  />
                ) : null}

                {question.questionType === 'NUMBER' ? (
                  <input
                    type="number"
                    className="w-40 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    value={(values[question.id] as number | string) ?? ''}
                    onChange={(e) => setValue(question.id, e.target.value === '' ? '' : Number(e.target.value))}
                  />
                ) : null}

                {question.questionType === 'RATING_5' ? (
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setValue(question.id, n)}
                        className={`size-11 rounded-full border text-sm font-medium transition-colors ${
                          values[question.id] === n
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-background hover:bg-muted'
                        }`}
                        aria-label={`ให้คะแนน ${n}`}
                      >
                        {n}
                      </button>
                    ))}
                    <span className="self-center text-xs text-muted-foreground">1 = น้อยที่สุด · 5 = มากที่สุด</span>
                  </div>
                ) : null}

                {question.questionType === 'SINGLE_CHOICE' ? (
                  <div className="space-y-2">
                    {(question.choices ?? []).map((choice) => (
                      <label key={choice} className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name={question.id}
                          checked={values[question.id] === choice}
                          onChange={() => setValue(question.id, choice)}
                        />
                        {choice}
                      </label>
                    ))}
                  </div>
                ) : null}

                {question.questionType === 'MULTI_CHOICE' ? (
                  <div className="space-y-2">
                    {(question.choices ?? []).map((choice) => (
                      <label key={choice} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={Array.isArray(values[question.id]) && (values[question.id] as string[]).includes(choice)}
                          onChange={() => toggleMulti(question.id, choice)}
                        />
                        {choice}
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {error ? (
        <div className="mt-4">
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}

      <div className="mt-6">
        <Button onClick={() => void submit()} disabled={isSubmitting}>
          {isSubmitting ? 'กำลังส่งคำตอบ…' : 'ส่งคำตอบ'}
        </Button>
      </div>
    </div>
  );
}
