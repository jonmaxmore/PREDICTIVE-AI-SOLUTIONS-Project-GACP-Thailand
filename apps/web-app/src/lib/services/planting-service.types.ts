export type PlotAssignmentInput = {
  plotId: string;
  allocatedAreaSqm: number;
  plannedPlantCount: number;
};

export type PlantingCycleSummary = {
  id: string;
  cycleName: string;
  status: string;
  startDate: string;
  expectedHarvestDate?: string | null;
  totalAreaSqm: number;
  plotCount: number;
  plannedPlantCount: number;
  cultivationMethods: string[];
  farm?: {
    id: string;
    farmName?: string;
  };
  plantSpecies?: {
    id: string;
    nameTH?: string;
    nameEN?: string;
    code?: string;
  };
  traceSummary?: {
    batchCount: number;
    lotCount: number;
  };
};

export type PlantingCycleDetail = PlantingCycleSummary & {
  certificate?: {
    id: string;
    certificateNumber?: string;
    status?: string;
    expiryDate?: string | null;
  } | null;
  notes?: string | null;
  seedSource?: string | null;
  actualHarvestDate?: string | null;
  plots: Array<{
    cyclePlotId: string;
    id: string;
    name: string;
    areaSqm: number;
    solarSystem: string;
    allocatedAreaSqm: number;
    plannedPlantCount: number;
  }>;
  activitySummary?: {
    total: number;
    recent: PlantingActivity[];
  };
  traceSummary?: {
    batchCount: number;
    lotCount: number;
    latestBatch?: {
      id: string;
      batchNumber: string;
      status: string;
      trackingUrl?: string | null;
    } | null;
  };
};

/**
 * R8 (design note 2026-08-20-planting-tnt-design) retired
 * per-plant tracking permanently. 'PLANT_UNIT' stays in the READ union
 * only because activities logged before the retirement still carry it and
 * must keep rendering; nothing in this app can create one, and the plant
 * a legacy row pointed at is no longer resolved or shown.
 */
export type PlantingActivity = {
  id: string;
  scope: 'CYCLE' | 'PLOT' | 'PLANT_UNIT';
  activityType: string;
  activityDate: string;
  quantity?: number | null;
  unit?: string | null;
  method?: string | null;
  weather?: string | null;
  /** ชื่อสารที่ใช้ + ผู้ปฏิบัติงานจริง — API ส่งกลับมาแล้ว (planting-cycle-service.toActivityResponse) */
  productName?: string | null;
  performedBy?: string | null;
  note?: string | null;
  attachmentIds?: string[];
  plotId?: string | null;
  plot?: {
    id: string;
    name: string;
  } | null;
  createdAt: string;
  updatedAt: string;
};

export type PlotCycleQr = {
  cyclePlotId: string;
  plotId: string | null;
  plotName: string | null;
  /**
   * The SEASON'S seal — a fresh UUID per (cycle, plot), reborn every round. It is a link in
   * the evidence chain and the thing already-printed stickers resolve through. It must never
   * be printed on a sign meant to stay in the field; `plotCode` is the one for that.
   */
  qrCode: string | null;
  trackingUrl: string | null;
  /** Same value as `qrCode`, under a name that says which of the two identities it is. */
  seasonalQrCode?: string | null;
  /** T8 — the PERMANENT plot code, printed on the sign. Null only for a plot minted before
   *  the code column existed and missed the backfill. */
  plotCode?: string | null;
  /** When a sign was last printed for this plot, and when a printed one was retired. */
  qrIssuedAt?: string | null;
  qrRevokedAt?: string | null;
  cultivationMethod: string;
  allocatedAreaSqm: number;
  plannedPlantCount: number;
};

export type PlotCycleTraceDetail = {
  qrCode: string;
  trackingUrl: string | null;
  source?: {
    plot?: {
      plotId?: string | null;
      plotName?: string | null;
      cyclePlotId?: string | null;
    };
    cycle?: {
      cycleId?: string | null;
      cycleName?: string | null;
    };
    cultivationMethod?: string | null;
  };
  traceSummary?: {
    batchCount?: number;
    lotCount?: number;
    latestBatch?: {
      id?: string;
      batchNumber?: string;
      trackingUrl?: string | null;
      lotCount?: number;
    } | null;
    latestLots?: Array<{
      id: string;
      lotNumber: string;
      trackingUrl?: string | null;
      qrCode?: string | null;
      batchId?: string | null;
      batchNumber?: string | null;
      createdAt?: string | null;
    }>;
  };
  links?: {
    latestBatchUrl?: string | null;
    requiresAuthentication?: boolean;
  };
};

export type PlantingCapacitySummary = {
  scope: 'ALL' | 'FARM';
  allowedAreaSqm: number;
  reservedAreaSqm: number;
  remainingAreaSqm: number;
  overReservedAreaSqm: number;
  farmBreakdown: Array<{
    farmId: string;
    farmName?: string | null;
    allowedAreaSqm: number;
    reservedAreaSqm: number;
    remainingAreaSqm: number;
    overReservedAreaSqm: number;
  }>;
};

export type FarmOption = {
  id: string;
  farmName?: string;
  status?: string;
  cultivationMethod?: string;
  // ที่ตั้ง — ใช้แยกฟาร์มชื่อซ้ำกันในตัวเลือก (ประตู /farms/my/eligible-for-planting คืนมาอยู่แล้ว)
  district?: string;
  province?: string;
};

export type PlotOption = {
  id: string;
  name: string;
  /** Square metres. Optional only while the expand window runs — see plotAreaSqm in @/lib/area. */
  areaSqm?: number | null;
  /** RETIRED - the pair areaSqm replaces. Dropped with the backend contract migration. */
  area: number;
  areaUnit: string;
  solarSystem: string;
};

export type PlantSpeciesOption = {
  id: string;
  code?: string;
  nameTH?: string;
  nameEN?: string;
};

export type CertificateOption = {
  id: string;
  certificateNumber?: string;
  siteName?: string;
  farmId?: string;
  status?: string;
  canonicalStatus?: string;
  expiryDate?: string | null;
};
