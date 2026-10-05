'use client';

/**
 * รายการแบบสำรวจที่เปิดรับคำตอบ (ACTIVE) สำหรับเกษตรกร —
 * สัญญา C05F680149 ต้นแบบที่ 2 (ระบบสำรวจความต้องการ, แบบสอบถามดิจิทัล 4 ภาค)
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ClipboardList, ChevronRight } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/primitives/card';
import { EmptyState } from '@/components/feature/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { apiClient } from '@/lib/api/api-client';

interface SurveyTemplate {
  id: string;
  title: string;
  description?: string | null;
  targetGroup: string;
  questions?: { id: string }[];
}

export default function ClientView() {
  const [surveys, setSurveys] = useState<SurveyTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const res = await apiClient.get<SurveyTemplate[]>('/api/surveys/active?targetGroup=FARMER');
        if (active && res.success && Array.isArray(res.data)) {
          setSurveys(res.data);
        }
      } catch {
        // list stays empty — EmptyState below explains
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
  }, []);

  return (
    <div className="mx-auto w-full px-4 py-6 md:px-6">
      <h1 className="text-xl font-semibold">แบบสำรวจความต้องการ</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        ความเห็นของท่านช่วยพัฒนาระบบและบริการสำหรับเกษตรกรผู้ปลูกสมุนไพรทั่วประเทศ
      </p>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : surveys.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={ClipboardList}
            title="ยังไม่มีแบบสำรวจที่เปิดรับคำตอบ"
            hint="เมื่อมีแบบสำรวจใหม่จะแสดงที่หน้านี้"
          />
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {surveys.map((survey) => (
            <Link key={survey.id} href={`/health/surveys/${survey.id}`}>
              <Card className="transition-shadow hover:shadow-md">
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <div className="font-medium">{survey.title}</div>
                    {survey.description ? (
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{survey.description}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {survey.questions?.length ?? 0} คำถาม
                    </p>
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
