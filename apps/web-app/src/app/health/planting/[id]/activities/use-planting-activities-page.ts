import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { toPlantingUserMessage } from '@/lib/planting-labels';
import {
  plantingService,
  type PlantingActivity,
  type PlantingCycleDetail,
} from '@/lib/services/planting-service';
import {
  NO_PERMISSION_TOOLTIP_TH,
  activityPermissionFor,
  computeCanLogSelectedActivity,
  useEntityPermissions,
} from '@/lib/services/use-entity-permissions';
import {
  INITIAL_ACTIVITY_FORM,
  type ActivityForm,
  type UploadedAttachment,
} from './planting-activities-page-config';

/**
 * R8 (design note 2026-08-20-planting-tnt-design) retired
 * per-plant tracking permanently, so this page no longer loads, searches
 * or submits PlantUnit rows: the finest scope an activity can carry is the
 * plot it happened on.
 */
export function usePlantingActivitiesPage(cycleId: string) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cycle, setCycle] = useState<PlantingCycleDetail | null>(null);
  const [activities, setActivities] = useState<PlantingActivity[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [uploadedAttachments, setUploadedAttachments] = useState<UploadedAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [form, setForm] = useState<ActivityForm>(INITIAL_ACTIVITY_FORM);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  // Farm-worker Wave C chunk 3 — per-type gating: logging the SELECTED
  // activity type requires the matching ACTIVITY_<TYPE> effective
  // permission in a workspace context (personal/solo → always true;
  // fetch errors fail OPEN; the BE re-checks with 403 regardless).
  const { has: hasWorkspacePermission, reportPermissionDenial } = useEntityPermissions();
  const requiredActivityPermission = activityPermissionFor(form.activityType);
  // F5 — extracted, behavior-tested derivation (polarity-proof).
  const canLogSelectedActivity =
    computeCanLogSelectedActivity(requiredActivityPermission, hasWorkspacePermission);

  const loadAll = useCallback(async () => {
    if (!cycleId) {
      return;
    }

    setLoading(true);
    setError(null);

    const [cycleResult, activityResult] = await Promise.all([
      plantingService.getCycleById(cycleId),
      plantingService.listActivities(cycleId, { page: 1, limit: 100 }),
    ]);

    if (!cycleResult.success || !cycleResult.data) {
      setError(toPlantingUserMessage(cycleResult.error || 'ไม่พบข้อมูลรอบปลูก'));
      setLoading(false);
      return;
    }

    const cycleDetail = cycleResult.data;
    setCycle(cycleDetail);
    setForm((prev) => {
      if (prev.plotId || !(cycleDetail?.plots || []).length) {
        return prev;
      }
      return {
        ...prev,
        plotId: String(cycleDetail?.plots?.[0]?.id || ''),
      };
    });
    setActivities(activityResult.success ? activityResult.data : []);

    setLoading(false);
  }, [cycleId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const uploadAttachment = useCallback(async (file: File | null) => {
    if (!file) {
      return;
    }

    setUploadingAttachment(true);

    try {
      const data = new FormData();
      data.append('file', file);
      data.append('slotId', `planting_activity_${Date.now()}`);
      data.append('stepKey', 'planting_activity');

      const payload = await api.post<{
          documentId?: string;
          fileName?: string;
          fileUrl?: string;
      }>('/applications/draft-documents', data);

      if (!payload?.success || !payload.data?.documentId) {
        throw new Error(payload?.error || 'ไม่สามารถอัปโหลดไฟล์แนบได้');
      }

      setUploadedAttachments((prev) => ([
        ...prev,
        {
          documentId: String(payload.data?.documentId || ''),
          fileName: String(payload.data?.fileName || file.name),
          fileUrl: String(payload.data?.fileUrl || ''),
        },
      ]));

      toast.success('อัปโหลดไฟล์แนบสำเร็จ', {
        description: file.name,
      });
    } catch (uploadError) {
      toast.error('อัปโหลดไฟล์แนบไม่สำเร็จ', {
        description: toPlantingUserMessage(uploadError instanceof Error ? uploadError.message : 'ไม่สามารถอัปโหลดไฟล์ได้'),
      });
    } finally {
      setUploadingAttachment(false);
      if (attachmentInputRef.current) {
        attachmentInputRef.current.value = '';
      }
    }
  }, []);

  const removeAttachment = useCallback(async (documentId: string) => {
    try {
      await api.delete(`/applications/draft-documents/${encodeURIComponent(documentId)}`);
    } catch {
      toast.warning('ลบไฟล์แนบไม่สำเร็จ', {
        description: 'ระบบลบรายการจากฟอร์มไม่สำเร็จ กรุณาลองใหม่',
      });
      return;
    }

    setUploadedAttachments((prev) => prev.filter((item) => item.documentId !== documentId));
  }, []);

  const plotOptions = useMemo(
    () => (cycle?.plots || []).map((plot) => ({
      value: plot.id,
      label: `${plot.name} (${Math.round(plot.allocatedAreaSqm).toLocaleString('th-TH')} ตร.ม.)`,
    })),
    [cycle?.plots],
  );

  const submitActivity = useCallback(async () => {
    if (!cycleId || !form.activityDate) {
      return;
    }

    // Wave C chunk 3 — answer before the POST fires; the BE re-checks and
    // would 403 ENTITY_PERMISSION_DENIED anyway (this is the friendly path).
    if (!canLogSelectedActivity) {
      toast.warning(NO_PERMISSION_TOOLTIP_TH, {
        description: `ต้องมีสิทธิ์บันทึกกิจกรรมประเภทนี้ (${requiredActivityPermission})`,
      });
      return;
    }

    if (form.scope === 'PLOT' && !form.plotId) {
      toast.warning('ข้อมูลไม่ครบ', { description: 'กรุณาเลือกแปลง' });
      return;
    }

    setSaving(true);

    const attachmentIds = uploadedAttachments.map((item) => item.documentId).filter(Boolean);

    const result = await plantingService.createActivity(cycleId, {
      scope: form.scope,
      ...(form.scope === 'PLOT' ? { plotId: form.plotId } : {}),
      activityType: form.activityType,
      activityDate: form.activityDate.toISOString(),
      ...(form.quantity !== undefined ? { quantity: form.quantity } : {}),
      unit: form.unit || null,
      method: form.method || null,
      weather: form.weather || null,
      productName: form.productName || null,
      performedBy: form.performedBy || null,
      note: form.note || null,
      attachmentIds,
    });

    setSaving(false);

    if (!result.success) {
      // F1(b) — a live 403 ENTITY_PERMISSION_DENIED proves the FE gate ran
      // on a STALE snapshot: evict so the next mount refetches (non-denial
      // failures no-op inside).
      reportPermissionDenial(result);
      toast.error('บันทึกไม่สำเร็จ', {
        description: toPlantingUserMessage(result.error || 'ไม่สามารถบันทึกกิจกรรมได้'),
      });
      return;
    }

    toast.success('บันทึกสำเร็จ', {
      description: 'กิจกรรมถูกบันทึกเรียบร้อยแล้ว',
    });

    setForm((prev) => ({
      ...prev,
      quantity: undefined,
      unit: '',
      method: '',
      weather: '',
      note: '',
    }));
    setUploadedAttachments([]);

    await loadAll();
  }, [cycleId, form, loadAll, uploadedAttachments, canLogSelectedActivity, requiredActivityPermission, reportPermissionDenial]);

  return {
    loading,
    saving,
    error,
    cycle,
    activities,
    showAdvanced,
    setShowAdvanced,
    uploadedAttachments,
    uploadingAttachment,
    form,
    setForm,
    attachmentInputRef,
    plotOptions,
    uploadAttachment,
    removeAttachment,
    submitActivity,
    canLogSelectedActivity,
    requiredActivityPermission,
  };
}
