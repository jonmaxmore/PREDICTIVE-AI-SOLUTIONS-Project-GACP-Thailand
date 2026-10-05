import { apiClient } from '@/lib/api';

import type {
  CertificateOption,
  FarmOption,
  PlantingActivity,
  PlantingCapacitySummary,
  PlantingCycleDetail,
  PlantingCycleSummary,
  PlantSpeciesOption,
  PlotAssignmentInput,
  PlotCycleQr,
  PlotCycleTraceDetail,
  PlotOption,
} from './planting-service.types';

export type {
  CertificateOption,
  FarmOption,
  PlantingActivity,
  PlantingCapacitySummary,
  PlantingCycleDetail,
  PlantingCycleSummary,
  PlantSpeciesOption,
  PlotAssignmentInput,
  PlotCycleQr,
  PlotCycleTraceDetail,
  PlotOption,
} from './planting-service.types';

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) {
    return value as T[];
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.data)) {
      return record.data as T[];
    }
  }

  return [];
}

/**
 * R8 (design note 2026-08-20-planting-tnt-design) retired
 * per-plant tracking permanently, so this service no longer exposes a door
 * to it: generateUnits, listPlantUnits, bulkConfirmPlantUnits,
 * confirmPlantingUnit and reconcilePlantUnits are gone, and so are the
 * integrity endpoints whose whole job was reconciling PlantUnit rows
 * against the plan. createCycle no longer asks the server to auto-mint
 * plants either. Traceability resolves to แปลง -> รอบปลูก -> รุ่นเก็บเกี่ยว -> ลอต.
 */
export const plantingService = {
  async getMyCycles(status?: string) {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    const result = await apiClient.get<PlantingCycleSummary[]>(`/planting-cycles/my${query}`);
    return {
      success: result.success,
      error: result.error,
      data: asArray<PlantingCycleSummary>(result.data),
    };
  },

  async getCycleById(cycleId: string) {
    return apiClient.get<PlantingCycleDetail>(`/planting-cycles/${cycleId}`);
  },

  async getFarms() {
    const result = await apiClient.get<FarmOption[]>('/farms/my/eligible-for-planting');
    return {
      success: result.success,
      error: result.error,
      data: asArray<FarmOption>(result.data),
    };
  },

  async getFarmPlots(farmId: string) {
    const result = await apiClient.get<PlotOption[]>(`/farms/${farmId}/plots`);
    // ขอบเขตที่ใบรับรองครอบคลุม มาข้าง `data` ไม่ใช่ข้างใน — หน้าเลือกแปลงใช้ทำให้
    // แปลงนอกขอบเขต "จางพร้อมบอกเหตุ" แทนการซ่อน
    // null = ยังไม่มีใบรับรองที่มีผล ⇒ ไม่ต้องกั้นอะไรในหน้าจอ
    const certifiedAreaTypes = Array.isArray(
      (result as { certifiedAreaTypes?: unknown }).certifiedAreaTypes,
    )
      ? ((result as { certifiedAreaTypes?: string[] }).certifiedAreaTypes as string[])
      : null;
    return {
      success: result.success,
      error: result.error,
      data: asArray<PlotOption>(result.data),
      certifiedAreaTypes,
    };
  },

  async getPlantSpecies() {
    const result = await apiClient.get<PlantSpeciesOption[]>('/plants');
    return {
      success: result.success,
      error: result.error,
      data: asArray<PlantSpeciesOption>(result.data),
    };
  },

  async getMyCertificates() {
    const result = await apiClient.get<CertificateOption[]>('/certificates/my');
    return {
      success: result.success,
      error: result.error,
      data: asArray<CertificateOption>(result.data),
    };
  },

  async createCycle(payload: {
    farmId: string;
    certificateId?: string | null;
    plantSpeciesId: string;
    cycleName: string;
    startDate: string;
    expectedHarvestDate?: string | null;
    plotAssignments: PlotAssignmentInput[];
    seedSource?: string | null;
    notes?: string | null;
  }) {
    return apiClient.post<{
      id: string;
      status: string;
      totalAreaSqm: number;
      cultivationMethods: string[];
      plotCount: number;
      plannedPlantCount: number;
      certificateId?: string | null;
      automation?: {
        plotQr?: {
          status: 'generated' | 'partial' | 'failed';
          generatedCount: number;
          missingCount: number;
        };
      };
      warnings?: string[];
    }>('/planting-cycles', payload);
  },

  async updateCycle(cycleId: string, payload: Record<string, unknown>) {
    return apiClient.patch<unknown>(`/planting-cycles/${cycleId}`, payload);
  },

  async listActivities(cycleId: string, options?: {
    page?: number;
    limit?: number;
    scope?: string;
    activityType?: string;
    plotId?: string;
  }) {
    const params = new URLSearchParams();
    if (options?.page) params.set('page', String(options.page));
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.scope) params.set('scope', options.scope);
    if (options?.activityType) params.set('activityType', options.activityType);
    if (options?.plotId) params.set('plotId', options.plotId);

    const query = params.toString();
    const endpoint = query
      ? `/planting-cycles/${cycleId}/activities?${query}`
      : `/planting-cycles/${cycleId}/activities`;

    const result = await apiClient.get<PlantingActivity[]>(endpoint);
    const payload = result.data as unknown as {
      data?: PlantingActivity[];
      pagination?: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    };

    return {
      success: result.success,
      error: result.error,
      data: Array.isArray(payload?.data) ? payload.data : asArray<PlantingActivity>(result.data),
      pagination: payload?.pagination,
    };
  },

  async createActivity(cycleId: string, payload: {
    scope: 'CYCLE' | 'PLOT';
    plotId?: string;
    activityType: string;
    activityDate: string;
    quantity?: number | null;
    unit?: string | null;
    method?: string | null;
    weather?: string | null;
    productName?: string | null;
    performedBy?: string | null;
    note?: string | null;
    attachmentIds?: string[];
  }) {
    return apiClient.post<PlantingActivity>(`/planting-cycles/${cycleId}/activities`, payload);
  },

  async harvestCycle(cycleId: string, payload: {
    harvestDate?: string;
    actualYield?: number;
    qualityGrade?: string;
    notes?: string;
  }) {
    return apiClient.post<unknown>(`/planting-cycles/${cycleId}/harvest`, payload);
  },

  async generatePlotCycleQrs(cycleId: string) {
    const result = await apiClient.post<PlotCycleQr[]>(`/planting-cycles/${cycleId}/plot-qrs/generate`, {});
    return {
      success: result.success,
      error: result.error,
      // S11 — pass the HTTP status + machine code through so callers can
      // branch on the workspace permission denial (403
      // ENTITY_PERMISSION_DENIED) instead of toasting every failure.
      status: result.status,
      code: result.code,
      data: asArray<PlotCycleQr>(result.data),
    };
  },

  async listPlotCycleQrs(cycleId: string) {
    const result = await apiClient.get<PlotCycleQr[]>(`/planting-cycles/${cycleId}/plot-qrs`);
    return {
      success: result.success,
      error: result.error,
      data: asArray<PlotCycleQr>(result.data),
    };
  },

  async getPlotCycleTrace(qrCode: string) {
    return apiClient.get<PlotCycleTraceDetail>(`/trace/plot-cycle/${encodeURIComponent(qrCode)}`);
  },

  async getCapacitySummary(farmId?: string | null) {
    const params = new URLSearchParams();
    if (farmId) {
      params.set('farmId', String(farmId));
    }
    const query = params.toString();
    return apiClient.get<PlantingCapacitySummary>(
      query ? `/planting-cycles/capacity/summary?${query}` : '/planting-cycles/capacity/summary',
    );
  },

  async harvestByPlots(cycleId: string, payload: {
    harvestDate?: string;
    plotHarvests: Array<{
      cyclePlotId: string;
      freshWeightKg: number;
      qualityGrade?: string | null;
      notes?: string | null;
      packagingRows: Array<{
        packageType: string;
        quantity: number;
        unitWeight: number;
        totalWeight?: number;
      }>;
    }>;
  }) {
    return apiClient.post<unknown>(`/planting-cycles/${cycleId}/harvest-batches`, payload);
  },

  /**
   * ผลวิเคราะห์ (COA) ของรุ่นเก็บเกี่ยว — T10
   *
   * แนบเป็น multipart เพราะสิ่งที่ส่งคือ "ไฟล์" ไม่ใช่ค่าที่พิมพ์: มติ operator
   * 2026-09-05 ตัดช่องกรอกค่า THC/CBD/ความชื้นออกทั้งหมด ไฟล์คือแหล่งความจริงเดียว
   */
  async listLabResults(batchId: string) {
    return apiClient.get<unknown>(`/harvest-batches/${batchId}/lab-results`);
  },

  async uploadLabResult(batchId: string, payload: {
    file: File;
    labName: string;
    reportNumber?: string;
    reportedAt?: string;
    verificationCode?: string;
  }) {
    const body = new FormData();
    body.append('file', payload.file);
    body.append('labName', payload.labName);
    if (payload.reportNumber) { body.append('reportNumber', payload.reportNumber); }
    if (payload.reportedAt) { body.append('reportedAt', payload.reportedAt); }
    if (payload.verificationCode) { body.append('verificationCode', payload.verificationCode); }
    return apiClient.post<unknown>(`/harvest-batches/${batchId}/lab-results`, body);
  },

};
