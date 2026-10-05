'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  RefreshCcw,
  Settings,
  Shield,
  Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Spinner } from '@/components/ui/spinner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api/api-client';
import { invalidateFeatureFlags } from '@/hooks/use-feature-flag';
import { SummaryHeader } from '@/components/feature';

type Tab = 'config' | 'deadline' | 'override';

interface SystemConfig {
  key: string;
  value: string;
  type: string;
  description: string;
  updatedAt: string | null;
}

/**
 * X5-FIX-C / H-5 (X-1) — Force-status path consolidation.
 *
 * Pre-X5 the codebase had TWO parallel admin force-status paths:
 *
 *   1. CANONICAL — `/admin/applications/[id]/force-status` page →
 *      <ForceStatusModal> → AdminB28Service.forceStatus() →
 *      POST /admin/applications/:id/force-status (Iter 28). Carries the
 *      structured `{ toStatus, reasonCode, reason }` payload, reason ≥
 *      10 chars, type-confirm app id, reason-code dropdown.
 *
 *   2. LEGACY — this page's <StatusOverridePanel> →
 *      POST /provider/admin/status-override (B5-era). Old payload shape
 *      `{ applicationId, newStatus, reason }`, no reason code, no
 *      type-confirm, no audit-log link in confirmation.
 *
 * Two parallel UX flows for the same conceptual action led to stale
 * audit rows missing `reasonCode`, inconsistent admin training, and
 * two endpoint surface areas to maintain in lock-step.
 *
 * Consolidation strategy (frontend-only): the legacy
 * <StatusOverridePanel> form body becomes a router that captures the
 * application id from the admin and routes them to the canonical
 * /admin/applications/[id]/force-status page (which carries the full
 * Iter 28 form). The legacy backend endpoint may still exist (deferred
 * to X5-FIX-A / X5.5 backlog per the X5 meeting plan) but the frontend
 * no longer reaches it, so all force-status mutations flow through the
 * single canonical endpoint.
 */

export default function AdminSettingsPage() {
  const [tab, setTab] = useState<Tab>('config');

  return (
    // Wave E.2-B (batch 8): SummaryHeader replaces inline h2+p.
    <div className="space-y-6">
      {/* X5-FIX-B H-11: gov-gradient brand cue on ADMIN header. */}
      <SummaryHeader
        eyebrow="ผู้ให้บริการ · ตั้งค่าระบบ"
        title="เครื่องมือบริหารระบบ"
        description="งานผู้ดูแลระบบ ตั้งค่าระบบ จัดการสถานะ และขยายเวลากำหนด"
        className="gov-gradient border-none shadow-xl shadow-primary/20"
      />

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-2">
        <TabButton active={tab === 'config'} icon={Settings} label="ตั้งค่าระบบ" onClick={() => setTab('config')} />
        <TabButton active={tab === 'deadline'} icon={Calendar} label="ขยายเวลากำหนดส่ง" onClick={() => setTab('deadline')} />
        <TabButton active={tab === 'override'} icon={Shield} label="เปลี่ยนสถานะฉุกเฉิน" onClick={() => setTab('override')} />
      </div>

      {tab === 'config' && <SystemConfigPanel />}
      {tab === 'deadline' && <DeadlineExtensionPanel />}
      {tab === 'override' && <StatusOverridePanel />}
    </div>
  );
}

/* ────────────────────────────────────────────── */
/*  Tab Button                                     */
/* ────────────────────────────────────────────── */
function TabButton({ active, icon: Icon, label, onClick }: {
  active: boolean;
  icon: React.ComponentType<{ className?: string | undefined }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition-all',
        active
          ? 'border-primary bg-primary/10 text-primary shadow-sm'
          : 'border-border bg-card text-muted-foreground hover:bg-muted/50'
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

/* ────────────────────────────────────────────── */
/*  System Config Panel                            */
/* ────────────────────────────────────────────── */
function SystemConfigPanel() {
  const [configs, setConfigs] = useState<SystemConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<SystemConfig[]>('/system-config');
      if (res.success && Array.isArray(res.data)) {
        setConfigs(res.data);
        const vals: Record<string, string> = {};
        for (const c of res.data) { vals[c.key] = c.value; }
        setEditValues(vals);
      }
    } catch { /* no-op */ }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async (key: string) => {
    setSaving(key);
    try {
      const res = await apiClient.put(`/system-config/${key}`, { value: editValues[key] });
      if (res.success) {
        // W3-C: the public-config session cache (ConfigProvider +
        // feature-flag hook) must not keep serving the pre-save value.
        invalidateFeatureFlags();
        setToast(`บันทึก ${key} สำเร็จ`);
        setTimeout(() => setToast(null), 3000);
      }
    } catch { /* no-op */ }
    setSaving(null);
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Spinner size="md" /></div>;
  }

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
        <CardTitle className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
          <Settings className="h-4 w-4 text-primary" />
          ข้อมูลหลักระบบ (System Configuration)
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6">
        {toast && (
          <div className="mb-4 flex items-center gap-2 rounded-xl bg-leaf-soft px-4 py-3 text-sm font-bold text-leaf-onSoft dark:bg-primary-900/30">
            <CheckCircle2 className="h-4 w-4" /> {toast}
          </div>
        )}
        {configs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">ไม่พบรายการตั้งค่า</p>
        ) : (
          <div className="space-y-4">
            {configs.map((cfg) => (
              <div key={cfg.key} className="rounded-xl border border-border p-3 transition-shadow duration-200 hover:shadow-md sm:p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-bold text-foreground">{cfg.key}</p>
                    {cfg.description && <p className="text-xs text-muted-foreground">{cfg.description}</p>}
                  </div>
                  <Badge variant="outline" className="text-[10px]">{cfg.type}</Badge>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    title="ค่าการตั้งค่า"
                    value={editValues[cfg.key] || ''}
                    onChange={(e) => setEditValues((p) => ({ ...p, [cfg.key]: e.target.value }))}
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg"
                    disabled={saving === cfg.key || editValues[cfg.key] === cfg.value}
                    onClick={() => save(cfg.key)}
                  >
                    {saving === cfg.key ? <RefreshCcw className="h-3 w-3 animate-spin" /> : 'บันทึก'}
                  </Button>
                </div>
                {cfg.updatedAt && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    อัปเดตล่าสุด: {new Date(cfg.updatedAt).toLocaleString('th-TH')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ────────────────────────────────────────────── */
/*  Deadline Extension Panel                       */
/* ────────────────────────────────────────────── */
function DeadlineExtensionPanel() {
  const [appId, setAppId] = useState('');
  const [days, setDays] = useState('5');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const submit = async () => {
    if (!appId.trim() || !reason.trim()) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await apiClient.post('/provider/admin/deadline-extension', {
        applicationId: appId.trim(),
        extensionDays: parseInt(days, 10) || 5,
        reason: reason.trim(),
      });
      setResult({ success: res.success, message: res.message || (res.success ? 'ขยายเวลาสำเร็จ' : 'เกิดข้อผิดพลาด') });
      if (res.success) {
        setAppId('');
        setDays('5');
        setReason('');
      }
    } catch {
      setResult({ success: false, message: 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์' });
    }
    setSubmitting(false);
  };

  return (
    <Card className="rounded-2xl border-border shadow-sm">
      <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
        <CardTitle className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
          <Clock className="h-4 w-4 text-primary" />
          ขยายเวลากำหนดแก้ไข (Deadline Extension)
        </CardTitle>
      </CardHeader>
      <CardContent className="max-w-lg p-6">
        <div className="space-y-4">
          <div className="rounded-xl bg-amber-50 p-4 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
            <p className="flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" /> คำเตือน</p>
            <p className="mt-1">การขยายเวลาจะบันทึกลงประวัติ Workflow ของคำขอ และไม่สามารถย้อนกลับได้</p>
          </div>

          <Field label="รหัสคำขอ (Application ID)" required>
            <input
              type="text"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="เช่น cm3x7..."
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>

          <Field label="จำนวนวันทำการ (Business Days)" required>
            <input
              type="number"
              title="จำนวนวันที่ขยาย"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              min={1}
              max={30}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>

          <Field label="เหตุผล" required>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ระบุเหตุผลที่ขยายเวลา (อย่างน้อย 5 ตัวอักษร)"
              rows={3}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>

          {result && (
            <div className={cn('rounded-xl p-3 text-sm font-bold', result.success ? 'bg-leaf-soft text-leaf-onSoft' : 'bg-red-50 text-red-700')}>
              {result.success ? <CheckCircle2 className="mr-2 inline h-4 w-4" /> : <AlertTriangle className="mr-2 inline h-4 w-4" />}
              {result.message}
            </div>
          )}

          <Button
            onClick={submit}
            disabled={submitting || !appId.trim() || !reason.trim()}
            className="w-full rounded-xl font-bold"
          >
            {submitting ? <RefreshCcw className="mr-2 h-4 w-4 animate-spin" /> : <Zap className="mr-2 h-4 w-4" />}
            ขยายเวลากำหนดส่ง
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ────────────────────────────────────────────── */
/*  Status Override Panel                          */
/* ────────────────────────────────────────────── */
/**
 * X5-FIX-C / H-5 — Force-status navigator.
 *
 * Previously this panel POSTed to the LEGACY
 * `/provider/admin/status-override` endpoint with the old
 * `{ applicationId, newStatus, reason }` payload, in parallel with the
 * canonical `/admin/applications/[id]/force-status` flow. The two
 * paths drifted (legacy lacks `reasonCode`, type-confirm app id,
 * reason-code dropdown, and the audit-log confirmation link).
 *
 * The frontend now consolidates by routing the admin to the canonical
 * page — this panel collects only the application id and redirects.
 * The canonical page carries the full Iter 28 form, validates the
 * application exists, and POSTs to the canonical endpoint via
 * AdminB28Service.forceStatus().
 *
 * This is a **single canonical force-status path** from the frontend's
 * perspective.
 */
function StatusOverridePanel() {
  const router = useRouter();
  const [appId, setAppId] = useState('');

  const navigateToForceStatus = () => {
    const trimmed = appId.trim();
    if (!trimmed) return;
    router.push(`/admin/applications/${encodeURIComponent(trimmed)}/force-status`);
  };

  return (
    <Card
      data-testid="status-override-navigator"
      className="rounded-2xl border-border shadow-sm"
    >
      <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
        <CardTitle className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
          <Shield className="h-4 w-4 text-red-500" />
          เปลี่ยนสถานะฉุกเฉิน (Admin Status Override)
        </CardTitle>
      </CardHeader>
      <CardContent className="max-w-lg p-6">
        <div className="space-y-4">
          <div className="rounded-xl bg-red-50 p-4 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400">
            <p className="flex items-center gap-2 font-bold">
              <AlertTriangle className="h-4 w-4" /> ⚠️ ระวัง การกระทำนี้ข้ามขั้นตอน Workflow ปกติ
            </p>
            <p className="mt-1">
              การเปลี่ยนสถานะฉุกเฉินใช้ฟอร์มรวมที่ /admin/applications/[id]/force-status บันทึก Audit Trail ทั้งหมด
              รวมถึงผู้ดำเนินการ วันเวลา และเหตุผล รหัสเหตุผล (reasonCode) และยืนยัน application id ด้วยการพิมพ์
            </p>
          </div>

          <Field label="รหัสคำขอ (Application ID)" required>
            <input
              type="text"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="เช่น cm3x7..."
              data-testid="status-override-app-id"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>

          <Button
            variant="destructive"
            onClick={navigateToForceStatus}
            disabled={!appId.trim()}
            data-testid="status-override-go"
            className="w-full rounded-xl font-bold"
          >
            <ArrowRight className="mr-2 h-4 w-4" />
            ไปยังหน้าเปลี่ยนสถานะฉุกเฉิน
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-bold text-foreground">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
