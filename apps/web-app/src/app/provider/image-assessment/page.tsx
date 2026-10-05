'use client';

/**
 * สัญญา C05F680149 ต้นแบบที่ 6 — "ระบบตรวจสอบและประเมิน (3 โมดูล)"
 *   6.1 ตรวจสอบรูปภาพ · 6.2 ให้คะแนนคุณภาพ · 6.3 ตรวจจับโรคพืช 7 โรค
 * เครื่องมือผู้ตรวจประเมิน — ผลเป็นการช่วยประเมิน ไม่ตัดสินการรับรอง.
 */

import { useEffect, useState } from 'react';
import { ImageIcon, Gauge, Bug, AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { Alert } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { Select } from '@/components/ui/select';
import { apiClient } from '@/lib/api/api-client';
import ProviderLayout from '../components/provider-layout';
import { ReferenceDataNotice } from '@/components/feature/reference-data-notice';

interface Catalog {
  diseases: string[];
  qualityDimensions: { key: string; labelTH: string; weight: number }[];
  classifierProvider: string;
  accuracyTarget: number;
  note: string;
}

interface DiseasePrediction { disease: string; confidence: number }
interface AssessResult {
  imageInspection: { passed: boolean; score: number; resolution: string; brightness: number; issues: string[] };
  plantCondition: { completenessScore: number; maturityStage: string; needsExpertConfirmation: boolean };
  disease: { provider: string; predictions: DiseasePrediction[]; top: DiseasePrediction; needsExpertConfirmation: boolean };
}

const MATURITY_TH: Record<string, string> = {
  IMMATURE: 'ยังไม่ถึงวัยเก็บเกี่ยว',
  MATURE: 'ถึงวัยเก็บเกี่ยว',
  OVER_MATURE: 'เลยวัยเก็บเกี่ยว/เสื่อม',
};

const DISEASE_TH: Record<string, string> = {
  HEALTHY: 'ปกติ (ไม่พบโรค)',
  LEAF_BLIGHT: 'ใบไหม้',
  POWDERY_MILDEW: 'ราแป้ง',
  LEAF_SPOT: 'ใบจุด',
  ROOT_ROT: 'โคนเน่า',
  WILT: 'ยอดเหี่ยว',
  PEST: 'แมลงศัตรูพืช',
  VIRUS: 'ไวรัส',
};

const HERB_OPTIONS = [
  { value: 'CANNABIS', label: 'กัญชา' },
  { value: 'TURMERIC', label: 'ขมิ้นชัน' },
  { value: 'GINGER', label: 'ขิง' },
  { value: 'BLACK_GALINGALE', label: 'กระชายดำ' },
  { value: 'PLAI', label: 'ไพล' },
  { value: 'KRATOM', label: 'กระท่อม' },
];

const QUALITY_DIMS = [
  { key: 'COLOR', labelTH: 'สี' },
  { key: 'SIZE', labelTH: 'ขนาด' },
  { key: 'MOISTURE', labelTH: 'ความชื้น' },
  { key: 'CONTAMINATION', labelTH: 'สิ่งปนเปื้อน' },
  { key: 'ACTIVE_COMPOUND', labelTH: 'สารสำคัญ' },
];

export default function ImageAssessmentPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);

  // 6.1 + 6.3
  const [herbCode, setHerbCode] = useState('CANNABIS');
  const [file, setFile] = useState<File | null>(null);
  const [assessing, setAssessing] = useState(false);
  const [assessResult, setAssessResult] = useState<AssessResult | null>(null);
  const [assessError, setAssessError] = useState<string | null>(null);

  // 6.2
  const [scores, setScores] = useState<Record<string, number>>({ COLOR: 80, SIZE: 80, MOISTURE: 80, CONTAMINATION: 80, ACTIVE_COMPOUND: 80 });
  const [scoring, setScoring] = useState(false);
  const [quality, setQuality] = useState<{ score: number; grade: string } | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const res = await apiClient.get<Catalog>('/api/image-assessment/catalog');
        if (active && res.success && res.data) { setCatalog(res.data); }
      } catch { /* non-fatal */ }
    })();
    return () => { active = false; };
  }, []);

  const runAssess = async () => {
    if (!file) { setAssessError('เลือกไฟล์รูปภาพก่อน'); return; }
    setAssessing(true);
    setAssessError(null);
    setAssessResult(null);
    try {
      const fd = new FormData();
      fd.append('image', file);
      fd.append('herbCode', herbCode);
      const res = await apiClient.post<AssessResult>('/api/image-assessment/assess', fd);
      if (res.success && res.data?.disease) {
        setAssessResult(res.data);
      } else {
        setAssessError('ประเมินภาพไม่สำเร็จ');
      }
    } catch {
      setAssessError('ประเมินภาพไม่สำเร็จ ตรวจสอบไฟล์ (รองรับ JPG/PNG) และสิทธิ์ผู้ตรวจ');
    } finally {
      setAssessing(false);
    }
  };

  const runScore = async () => {
    setScoring(true);
    setQuality(null);
    setScoreError(null);
    try {
      const res = await apiClient.post<{ score: number; grade: string }>('/api/image-assessment/quality-score', {
        subScores: scores, herbCode,
      });
      if (res.success && res.data) {
        setQuality(res.data);
      } else {
        setScoreError('คำนวณคะแนนคุณภาพไม่สำเร็จ');
      }
    } catch {
      setScoreError('คำนวณคะแนนคุณภาพไม่สำเร็จ ต้องเป็นผู้ตรวจ (AUDIT_STAFF) และกรอกคะแนนย่อยให้ครบ');
    } finally {
      setScoring(false);
    }
  };

  return (
    <ProviderLayout heading title="ระบบตรวจสอบและประเมิน (3 โมดูล)" subtitle="Image Assessment · THRSP ต้นแบบที่ 6">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 lg:px-8">
        <ReferenceDataNotice
          title="ผลการประเมินเป็นการประเมินเบื้องต้น"
          body="ผลการตรวจสอบภาพ การให้คะแนนคุณภาพ และการคาดการณ์โรคพืชทั้งหมดเป็นการประเมินเบื้องต้นด้วยระบบ เพื่อใช้ประกอบการพิจารณาเท่านั้น มิใช่คำวินิจฉัยขั้นสุดท้าย โปรดให้ผู้เชี่ยวชาญยืนยันผลก่อนนำไปใช้ตัดสินการรับรอง"
        />
        {catalog ? (
          <Alert variant="info">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span className="text-sm">{catalog.note}</span>
            </div>
          </Alert>
        ) : null}

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* 6.1 + 6.3 */}
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="mb-3 flex items-center gap-2 font-semibold">
              <ImageIcon className="size-5 text-primary" /> ตรวจสอบรูปภาพ + ตรวจจับโรคพืช
              <Bug className="size-4 text-muted-foreground" />
            </div>
            <div className="space-y-3">
              <Select label="ชนิดสมุนไพร" value={herbCode} onChange={(v) => setHerbCode(v || 'CANNABIS')} data={HERB_OPTIONS} />
              <label className="block" htmlFor="ia-file">
                <span className="mb-1 block text-sm font-medium">รูปภาพใบ/ผลผลิต (JPG/PNG)</span>
                <input
                  id="ia-file"
                  type="file"
                  accept="image/jpeg,image/png"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <Button onClick={() => void runAssess()} disabled={assessing || !file}>
                {assessing ? 'กำลังประเมิน…' : 'ประเมินภาพ'}
              </Button>
              {assessError ? <Alert variant="error">{assessError}</Alert> : null}
            </div>

            {assessing ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : assessResult ? (
              <div className="mt-4 space-y-4">
                {/* 6.1 */}
                <div className="rounded-xl border border-border p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    คุณภาพภาพ (6.1)
                    <Badge tone={assessResult.imageInspection.passed ? 'success' : 'danger'}>
                      {assessResult.imageInspection.passed ? 'ผ่าน' : 'ไม่ผ่าน'} · {assessResult.imageInspection.score}/100
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">ความละเอียด {assessResult.imageInspection.resolution} · ความสว่าง {assessResult.imageInspection.brightness}</div>
                  {assessResult.imageInspection.issues.length > 0 ? (
                    <ul className="mt-1 list-inside list-disc text-xs text-amber-700">
                      {assessResult.imageInspection.issues.map((iss, i) => <li key={i}>{iss}</li>)}
                    </ul>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2 text-sm">
                    <span className="text-muted-foreground">ความสมบูรณ์พืช</span>
                    <span className="font-medium">{assessResult.plantCondition.completenessScore}/100</span>
                    <span className="text-muted-foreground">· อายุเก็บเกี่ยว</span>
                    <Badge tone="neutral">
                      {MATURITY_TH[assessResult.plantCondition.maturityStage] ?? assessResult.plantCondition.maturityStage}
                    </Badge>
                    <span className="text-xs text-muted-foreground">(baseline)</span>
                  </div>
                </div>

                {/* 6.3 */}
                <div className="rounded-xl border border-border p-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    ผลตรวจจับโรคพืช (6.3)
                    {assessResult.disease.needsExpertConfirmation ? (
                      <Badge className="border-amber-200 bg-amber-100 text-amber-800">ต้องยืนยันโดยผู้เชี่ยวชาญ</Badge>
                    ) : null}
                  </div>
                  <div className="mt-2 space-y-1">
                    {assessResult.disease.predictions.slice(0, 4).map((p) => (
                      <div key={p.disease} className="flex items-center gap-2 text-sm">
                        <span className="min-w-28">{DISEASE_TH[p.disease] ?? p.disease}</span>
                        <span className="h-2 rounded bg-primary/60" style={{ width: `${Math.round(p.confidence * 120)}px` }} />
                        <span className="text-muted-foreground">{(p.confidence * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">provider: {assessResult.disease.provider}</p>
                </div>
              </div>
            ) : null}
          </div>

          {/* 6.2 */}
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="mb-3 flex items-center gap-2 font-semibold">
              <Gauge className="size-5 text-primary" /> ให้คะแนนคุณภาพ (5 ด้าน)
            </div>
            <div className="space-y-3">
              {QUALITY_DIMS.map((dim) => (
                <label key={dim.key} className="block" htmlFor={`q-${dim.key}`}>
                  <span className="mb-1 flex justify-between text-sm">
                    <span>{dim.labelTH}</span>
                    <span className="font-medium">{scores[dim.key]}</span>
                  </span>
                  <input
                    id={`q-${dim.key}`}
                    type="range"
                    min={0}
                    max={100}
                    aria-label={dim.labelTH}
                    value={scores[dim.key]}
                    onChange={(e) => setScores((s) => ({ ...s, [dim.key]: Number(e.target.value) }))}
                    className="w-full"
                  />
                </label>
              ))}
              <Button onClick={() => void runScore()} disabled={scoring}>
                {scoring ? 'กำลังคำนวณ…' : 'คำนวณคะแนนคุณภาพ'}
              </Button>
              {scoreError ? <Alert variant="error">{scoreError}</Alert> : null}
            </div>

            {quality ? (
              <div className="mt-4 rounded-xl border border-border p-4 text-center">
                <div className="text-sm text-muted-foreground">คะแนนคุณภาพรวม</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{quality.score}<span className="text-base text-muted-foreground">/100</span></div>
                <Badge tone="success" className="mt-2">เกรด {quality.grade}</Badge>
                <p className="mt-2 text-xs text-muted-foreground">เอกสารประเมินคุณภาพผลผลิต ไม่ใช่ใบรับรอง GACP</p>
              </div>
            ) : null}
          </div>
        </div>

        {catalog ? (
          <p className="mt-6 text-xs text-muted-foreground">
            ตรวจจับได้ {catalog.diseases.filter((d) => d !== 'HEALTHY').length} โรค · เป้าความแม่นยำ ≥ {Math.round(catalog.accuracyTarget * 100)}% (วัดด้วย confusion matrix จากภาพที่ติดป้ายกำกับในช่วง pilot)
          </p>
        ) : null}
      </div>
    </ProviderLayout>
  );
}
