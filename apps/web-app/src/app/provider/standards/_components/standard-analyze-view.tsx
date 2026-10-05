'use client';

/**
 * Shared gap-analysis view for สัญญา C05F680149 ต้นแบบที่ 1
 * "ระบบวิเคราะห์มาตรฐาน GACP (3 ระบบ)" — WHO (1.1) / Thai FDA (1.2) / ASEAN (1.3).
 *
 * Staff picks an application in the org → GET /api/standards/:code/analyze/:id →
 * renders the per-requirement MET / NOT_MET / NEEDS_REVIEW verdicts with Thai
 * evidence + recommendations from the backend engine
 * (services/standards-analyzer-service.js). BE is authoritative — this view
 * renders verdicts, it never computes them.
 */

import { useState, useEffect, useMemo } from 'react';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { Select } from '@/components/ui/select';
import { apiClient } from '@/lib/api/api-client';
import { providerApiPaths } from '@/lib/services/provider-api';

interface ApplicationRow {
  id: string;
  applicationNumber?: string;
  applicantName?: string;
  plantType?: string;
  status?: string;
}

interface RequirementResult {
  id: string;
  category: string;
  name: string;
  nameTH: string;
  description: string | null;
  isRequired: boolean;
  status: 'MET' | 'NOT_MET' | 'NEEDS_REVIEW';
  evidence: string | null;
  recommendation: string | null;
}

interface AnalysisResult {
  standard: { code: string; name: string; nameTH: string; version: string; targetMarket: string | null };
  application: { id: string; applicationNumber: string | null; status: string };
  requirements: RequirementResult[];
  summary: {
    total: number;
    met: number;
    notMet: number;
    needsReview: number;
    requiredTotal: number;
    requiredMet: number;
    readinessPct: number;
  };
  analyzedAt: string;
}

const STATUS_BADGE: Record<RequirementResult['status'], { label: string; className: string }> = {
  MET: { label: 'ผ่าน', className: 'bg-leaf-soft text-leaf-onSoft border-leaf-300' },
  NEEDS_REVIEW: { label: 'รอประเมิน', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  NOT_MET: { label: 'ยังไม่ผ่าน', className: 'bg-red-100 text-red-700 border-red-200' },
};

export function StandardAnalyzeView({ standardCode }: { standardCode: string }) {
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const loadApplications = async () => {
      setIsLoadingList(true);
      try {
        const res = await apiClient.get<{ applications: ApplicationRow[] }>(providerApiPaths.applicationsList);
        if (active && res.success && res.data?.applications) {
          setApplications(res.data.applications);
        }
      } catch {
        if (active) {
          setError('โหลดรายการคำขอไม่สำเร็จ');
        }
      } finally {
        if (active) {
          setIsLoadingList(false);
        }
      }
    };
    void loadApplications();
    return () => {
      active = false;
    };
  }, []);

  const options = useMemo(
    () =>
      applications.map((app) => ({
        value: app.id,
        label: [app.applicationNumber ?? app.id.slice(0, 8), app.applicantName, app.plantType]
          .filter(Boolean)
          .join(' · '),
      })),
    [applications],
  );

  const analyze = async () => {
    if (!selectedId) {
      return;
    }
    setIsAnalyzing(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiClient.get<AnalysisResult>(
        `/api/standards/${encodeURIComponent(standardCode)}/analyze/${encodeURIComponent(selectedId)}`,
      );
      if (res.success && res.data?.requirements) {
        setResult(res.data);
      } else {
        setError('วิเคราะห์ไม่สำเร็จ ลองใหม่อีกครั้ง');
      }
    } catch {
      setError('วิเคราะห์ไม่สำเร็จ ตรวจสอบว่ามีการ seed มาตรฐานในระบบแล้ว');
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-card p-4 md:p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="เลือกคำขอรับรอง"
            placeholder={isLoadingList ? 'กำลังโหลดรายการคำขอ…' : 'เลือกคำขอที่จะวิเคราะห์'}
            value={selectedId}
            onChange={(value) => setSelectedId(value || '')}
            data={options}
          />
          <div className="flex items-end">
            <Button onClick={() => void analyze()} disabled={!selectedId || isAnalyzing}>
              {isAnalyzing ? 'กำลังวิเคราะห์…' : 'วิเคราะห์ความสอดคล้อง'}
            </Button>
          </div>
        </div>
        {error ? (
          <div className="mt-4">
            <Alert variant="error">{error}</Alert>
          </div>
        ) : null}
      </div>

      {isAnalyzing ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : null}

      {result ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <SummaryTile label="ความพร้อมรวม" value={`${result.summary.readinessPct}%`} />
            <SummaryTile label="ผ่าน" value={`${result.summary.met}/${result.summary.total}`} tone="text-leaf-700" />
            <SummaryTile label="รอประเมิน" value={String(result.summary.needsReview)} tone="text-amber-700" />
            <SummaryTile label="ยังไม่ผ่าน" value={String(result.summary.notMet)} tone="text-red-700" />
          </div>

          <div className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3 text-sm text-muted-foreground md:px-6">
              คำขอ {result.application.applicationNumber ?? result.application.id} · สถานะ {result.application.status} ·
              มาตรฐาน {result.standard.nameTH} ({result.standard.version})
            </div>
            <ul className="divide-y divide-border">
              {result.requirements.map((req) => {
                const badge = STATUS_BADGE[req.status];
                return (
                  <li key={req.id} className="px-4 py-4 md:px-6">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={badge.className}>{badge.label}</Badge>
                      <span className="font-medium">{req.nameTH}</span>
                      <span className="text-sm text-muted-foreground">({req.category})</span>
                      {req.isRequired ? (
                        <span className="text-xs text-red-600">* บังคับ</span>
                      ) : null}
                    </div>
                    {req.evidence ? (
                      <p className="mt-2 text-sm text-muted-foreground">{req.evidence}</p>
                    ) : null}
                    {req.recommendation ? (
                      <p className="mt-1 text-sm text-amber-800">คำแนะนำ: {req.recommendation}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>

          <p className="text-xs text-muted-foreground">
            ผลวิเคราะห์เป็นเครื่องมือช่วยประเมินช่องว่าง (gap analysis) การอนุมัติรับรองยังเป็นการตัดสินใจของ
            ผู้ตรวจประเมินตามกระบวนการปกติ
          </p>
        </div>
      ) : null}
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

export default StandardAnalyzeView;
