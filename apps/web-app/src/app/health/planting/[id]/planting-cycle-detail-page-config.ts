import { type PlantingCycleDetail } from '@/lib/services/planting-service';

export const STATUS_META: Record<string, { label: string; color: string }> = {
  PLANNING: { label: 'วางแผน', color: 'gray' },
  PLANTED: { label: 'ปลูกแล้ว', color: 'blue' },
  GROWING: { label: 'กำลังเติบโต', color: 'teal' },
  READY_HARVEST: { label: 'พร้อมเก็บเกี่ยว', color: 'orange' },
  HARVESTED: { label: 'เก็บเกี่ยวแล้ว', color: 'green' },
  COMPLETED: { label: 'ปิดรอบแล้ว', color: 'grape' },
};

export const PROCESS_STATUS_META = {
  done: { label: 'เสร็จแล้ว', color: 'green' },
  action: { label: 'ต้องดำเนินการ', color: 'blue' },
  blocked: { label: 'ติดเงื่อนไข', color: 'yellow' },
  pending: { label: 'รอขั้นก่อนหน้า', color: 'gray' },
} as const;

export type ProcessStatus = keyof typeof PROCESS_STATUS_META;

export type PackagingRowForm = {
  packageType: string;
  quantity: number;
  unitWeight: number;
};

export type PlotHarvestForm = {
  freshWeightKg: number;
  qualityGrade: string;
  notes: string;
  packagingRows: PackagingRowForm[];
};

// R8 (design note 2026-08-20-planting-tnt-design) retired per-plant
// tracking permanently, so this file no longer carries a per-plant status
// vocabulary, a per-plant page size, or a per-plant tab: the finest thing this
// screen resolves is the plot inside its planting cycle.
export const TABS = ['overview', 'plots', 'activities', 'trace', 'history'] as const;

export function getStatusMeta(status?: string) {
  return STATUS_META[String(status || '').toUpperCase()] || { label: status || '-', color: 'gray' };
}

export function isCertificateActive(cycle: PlantingCycleDetail | null) {
  const status = String(cycle?.certificate?.status || '').toLowerCase();
  if (status !== 'active') {
    return false;
  }
  if (!cycle?.certificate?.expiryDate) {
    return true;
  }
  return new Date(cycle.certificate.expiryDate).getTime() >= Date.now();
}

export function createDefaultPackagingRow(): PackagingRowForm {
  return {
    packageType: 'กระสอบ',
    quantity: 1,
    unitWeight: 1,
  };
}

export function sumPackagingWeight(rows: PackagingRowForm[]) {
  return rows.reduce((sum, row) => sum + (Number(row.quantity || 0) * Number(row.unitWeight || 0)), 0);
}

export function toAbsoluteUrl(targetUrl: string) {
  if (/^https?:\/\//i.test(targetUrl)) {
    return targetUrl;
  }
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${targetUrl.startsWith('/') ? '' : '/'}${targetUrl}`;
  }
  return targetUrl;
}


