export type PlantId = 'cannabis' | 'kratom' | 'turmeric' | 'ginger' | 'black_galangal' | 'plai';
export type ServiceType = 'NEW' | 'RENEWAL' | 'MODIFY' | 'REPLACEMENT';
export type PlantGroup = 'HIGH_CONTROL' | 'GENERAL';
/**
 * The application purposes — RESEARCH ภ.ท. 09, EXPORT ภ.ท. 10, PROCESSING ภ.ท. 11 (operator
 * ruling 2026-10-05). The words and their licences live in lib/certification-purposes.ts.
 */
export type { CertificationPurpose } from '@/lib/certification-purposes';
export type SiteType = 'OUTDOOR' | 'INDOOR' | 'GREENHOUSE';
export type CultivationMethod = 'outdoor' | 'greenhouse' | 'indoor' | 'vertical' | 'hydroponic';
export type MainCultivationType = 'outdoor' | 'greenhouse' | 'indoor';
export type WizardSyncStatus = 'SYNCED' | 'PENDING' | 'ERROR';
export interface Plant {
    id: PlantId;
    name: string;
    icon: string;
    group: PlantGroup;
}
export const PLANTS: Plant[] = [
    { id: 'cannabis', name: 'กัญชา', icon: '', group: 'HIGH_CONTROL' },
    { id: 'kratom', name: 'กระท่อม', icon: '', group: 'HIGH_CONTROL' },
    { id: 'turmeric', name: 'ขมิ้นชัน', icon: '', group: 'GENERAL' },
    { id: 'ginger', name: 'ขิง', icon: '', group: 'GENERAL' },
    { id: 'black_galangal', name: 'กระชายดำ', icon: '', group: 'GENERAL' },
    { id: 'plai', name: 'ไพล', icon: '', group: 'GENERAL' },
];
// Expanded ApplicantData with all fields for INDIVIDUAL, JURISTIC, COMMUNITY
export interface ApplicantData {
    applicantType: 'INDIVIDUAL' | 'JURISTIC' | 'COMMUNITY';
    // บุคคลธรรมดา (Individual)
    firstName?: string;
    lastName?: string;
    fullName?: string;
    idCard?: string;
    phone?: string;
    email?: string;
    lineId?: string;
    address?: string;
    province?: string;
    district?: string;
    subdistrict?: string;
    postalCode?: string;
    // วิสาหกิจชุมชน (Community Enterprise)
    communityName?: string;           // ชื่อวิสาหกิจชุมชน
    communityAddress?: string;        // ที่อยู่วิสาหกิจชุมชน
    communityRegDate?: string;        // วันที่จดทะเบียน
    presidentName?: string;           // ชื่อประธาน
    presidentIdCard?: string;         // เลขบัตรประชาชนประธาน
    presidentPhone?: string;          // โทรศัพท์ประธาน
    memberCount?: number;             // จำนวนสมาชิก
    registrationSVC01?: string;       // รหัส สวช.01
    registrationTVC3?: string;        // รหัส ท.ว.ช.3
    houseRegistrationCode?: string;   // เลขรหัสประจำบ้าน
    registeredAddress?: string;       // ที่อยู่ตามทะเบียนบ้าน
    // นิติบุคคล (Juristic Person)
    companyName?: string;             // ชื่อสถานประกอบการ/บริษัท
    companyAddress?: string;          // ที่อยู่สถานที่จัดตั้ง
    companyPhone?: string;            // โทรศัพท์สถานที่จัดตั้ง
    companyType?: string;             // ประเภทนิติบุคคล
    taxId?: string;                   // เลขประจำตัวผู้เสียภาษี
    registeredCapital?: string;       // ทุนจดทะเบียน
    directorName?: string;            // ชื่อประธานกรรมการ
    directorIdCard?: string;          // เลขบัตรประชาชนกรรมการ
    directorPhone?: string;           // โทรศัพท์ประธานกรรมการ
    directorEmail?: string;           // อีเมลประธาน
    directorPosition?: string;        // ตำแหน่ง
    registrationNumber?: string;      // เลขทะเบียนนิติบุคคล/เลขผู้เสียภาษี
    powerOfAttorneyUrl?: string;      // หนังสือมอบอำนาจ (PDF URL)
    coordinatorName?: string;         // ชื่อผู้ประสานงาน (กรณีมอบอำนาจ)
    coordinatorPhone?: string;        // โทรศัพท์ผู้ประสานงาน
    coordinatorLineId?: string;       // Line ID ผู้ประสานงาน
    contactName?: string;             // ชื่อผู้ติดต่อ
    contactPhone?: string;            // โทรศัพท์ผู้ติดต่อ
    contactEmail?: string;            // อีเมลผู้ติดต่อ

    // เพิ่มเติม (Documents)
    idCardDoc?: string;
    houseRegDoc?: string;
    communityRegDoc?: string;
    communityMeetingDoc?: string;
    companyRegDoc?: string;
    directorListDoc?: string;
    contact?: string; // Adding to match potential usage

    // Legacy fields
    responsibleName?: string;
    qualification?: string;
    plantingStatus?: 'NOTIFY' | 'LICENSED';
    licenseNumber?: string;
    licenseType?: 'BHT11' | 'BHT13' | 'BHT16';

    // [GACP] Personnel Hygiene (หมวด 3: บุคลากร)
    personnelHygiene?: {
        trainingProvided: boolean; // การอบรม
        healthCheck: boolean;      // ตรวจสุขภาพ
        protectiveGear: boolean;   // อุปกรณ์ป้องกัน (PPE)
    };
}

// [NEW] General Information
export interface GeneralInfo {
    projectName: string;
    certType: string;
}

// [NEW] Plot Definition
export interface Plot {
    id: string; // uuid or temp-id
    name: string; // e.g., "Greenhouse A"
    areaSize: string; // e.g., "2"
    /** Square metres. See totalAreaUnit. */
    areaUnit: 'Sqm';
    solarSystem: 'OUTDOOR' | 'INDOOR' | 'GREENHOUSE';
    latitude?: number;
    longitude?: number;
    // [NEW] Dynamic cultivation config fields
    farmLayoutId?: string; // e.g., "row_cultivation", "raised_bed"
    growingStyleId?: string; // e.g., "sog", "scrog", "vertical" (indoor only)
    tiers?: number; // For vertical farming (1-5)
    estimatedPlants?: number; // Calculated plant count
    plantDensity?: number; // plants per sqm

    // [GACP] Soil Analysis (หมวด 4: วัสดุปลูก)
    soilType?: string; // ประเภทดิน
    soilAnalysisStatus?: 'none' | 'pending' | 'passed' | 'failed';
    hasHeavyMetalTest?: boolean;
    hasPesticideTest?: boolean;

    // [GACP] Seed/Material Source (หมวด 4)
    seedSource?: string; // แหล่งเมล็ดพันธุ์
    seedCertificate?: boolean; // มีใบรับรองเมล็ดพันธุ์
    seedProviderName?: string;

    // [GACP] IPM Plan (หมวด 6)
    hasIPMPlan?: boolean;
    ipmMethods?: string[]; // วิธีการป้องกันศัตรูพืช
}

// [NEW] Farm Data - สถานประกอบการ
export interface FarmData {
    id?: string;
    farmName: string; // ชื่อฟาร์ม
    address: string;
    province: string;
    district: string;
    subdistrict: string;
    postalCode: string;
    // GPS จุดศูนย์กลาง
    gpsLat?: string;
    gpsLng?: string;
    // พื้นที่รวม
    totalAreaSize: string;
    /** Square metres. The only unit the platform uses; kept on the payload
     *  so a draft started before the switch still round-trips. */
    totalAreaUnit: 'Sqm';
    // กรรมสิทธิ์
    landOwnership: 'OWN' | 'RENT' | 'CONSENT';
    // อาณาเขต
    northBorder?: string;
    southBorder?: string;
    eastBorder?: string;
    westBorder?: string;
    // โครงสร้างพื้นฐาน
    waterSource?: string;
    electricitySource?: string;
    waterSourceDetail?: {
        sourceType?: string;
        otherSourceType?: string;
        filtrationTypes?: string[];
        irrigationType?: string;
        hasWaterTest?: boolean;
        waterTestFileName?: string;
        /**
         * Set only when the server accepted the file and returned a URL.
         *
         * `waterTestFileName` is a display string and proves nothing: step 5
         * once recorded a filename without uploading anything, step 8 read it
         * as evidence and removed the required slot, and applications were
         * submitted with no water-quality report. Presence of this field is
         * the only thing that may suppress the WATER_TEST requirement.
         */
        waterTestFileUrl?: string;
    };
    landDocuments?: {
        checks?: Record<string, boolean>;
        otherName?: string;
        files?: Array<{
            type: string;
            name?: string;
            fileName?: string;
            /** Set only when the server accepted the file. See waterTestFileUrl. */
            fileUrl?: string;
        }>;
    };

    // [GACP] Soil Information
    soilType?: string;          // e.g., "Clay", "Loam"
    soilPH?: string;            // [NEW]
    soilHistory?: string;       // [NEW] History of land use

    // ระบบรักษาความปลอดภัย
    hasFence?: boolean;
    hasCCTV?: boolean;
    hasAccessControl?: boolean;
    hasWarningSign?: boolean;
    // เอกสารฟาร์ม
    documents?: StepDocument[];
    environmentChecks?: Record<string, boolean>;
    securityChecks?: Record<string, boolean>;
}

// [NEW] Lot - ล็อตการผลิต
export interface Lot {
    id: string;
    lotCode: string; // e.g., "LOT-67-001"
    plotId: string; // เชื่อมกับแปลง
    plotName?: string; // for display
    plantCount: number; // จำนวนต้นที่จะปลูก
    estimatedPlantingDate?: string; // ISO date
    estimatedHarvestDate?: string; // ISO date
    estimatedYieldKg?: number; // [NEW] Added for GACP
    status: 'PLANNED' | 'ACTIVE' | 'HARVESTED' | 'CANCELLED';
    notes?: string;
    // เอกสารล็อต
    documents?: StepDocument[];
}

// Expanded SiteData with all fields from original Step6SiteSecurity
export interface SiteData {
    siteName: string;
    siteAddress?: string;
    address: string;
    province: string;
    district: string;
    subdistrict: string;
    postalCode: string;
    gpsLat?: string;
    gpsLng?: string;
    latitude?: number;
    longitude?: number;
    areaSize?: string;
    areaUnit?: string;
    northBorder?: string;
    southBorder?: string;
    eastBorder?: string;
    westBorder?: string;
    landOwnership?: 'OWN' | 'RENT' | 'CONSENT';
    soilType?: string;          // Added for GACP
    waterSource?: string;       // Added for GACP
    hasCCTV?: boolean;
    hasFence2m?: boolean;
    hasAccessLog?: boolean;
    hasBiometric?: boolean;
    hasAnimalFence?: boolean;
    hasZoneSign?: boolean;

    // [NEW] Plot Management
    plots?: Plot[];
}

// [NEW] Plant Variety Detail
export interface PlantVariety {
    id: string;
    name: string;
    sourceType: 'SELF' | 'BUY' | 'IMPORT';
    sourceName?: string; // Shop name or location
    quantity?: number;
}

// Expanded ProductionData with all fields from original Step5Production
export interface ProductionData {
    plantParts?: string[];
    plantPartsOther?: string;
    /**
     * Multi-select propagation methods (applicants commonly use more than one).
     * Legacy single-string drafts are coerced to a one-element array on load
     * by production-info-step.tsx — see issue 4 in the applicant feedback batch.
     */
    propagationType?: ('SEED' | 'CUTTING' | 'TISSUE' | 'SEEDLING' | 'OTHER')[];
    cultivationMethods?: MainCultivationType[]; // Added for GACP - support multiple methods
    irrigationType?: 'DRIP' | 'SPRINKLER' | 'MANUAL' | 'FLOOD'; // Added for GACP

    // Varieties (Upgraded from single varietyName)
    varieties?: PlantVariety[]; // [NEW]
    varietyName?: string;       // Deprecated but kept for compatibility

    seedSource?: string;
    varietySource?: string;
    treeCount?: number;
    areaSizeRai?: number;
    quantityWithUnit?: string;
    harvestCycles?: number;
    estimatedYield?: number;
    sourceType?: 'SELF' | 'BUY' | 'IMPORT';
    sourceDetail?: string;
    hasGAPCert?: boolean;
    hasOrganicCert?: boolean;
    cultivationArea?: string;
    annualProduction?: string;
    harvestMethod?: string;
    storageMethod?: string;
    qualityControl?: string;
    spacing?: string;
    plantCount?: string;

    // [NEW] Integrated Pest Management (GACP)
    hasIpmPlan?: boolean;
    ipmMethods?: string[];
    ipmNote?: string;
}

export interface SecurityData {
    hasFence: boolean;
    hasCCTV: boolean;
    hasGuard: boolean;
    hasAccessControl: boolean;
    securityNotes?: string;
}

// [NEW] Harvest & Post-Harvest
export interface HarvestData {
    harvestMethod: 'MANUAL' | 'MACHINE' | '';
    // Harvest Details
    harvestMaturity?: 'EARLY' | 'PEAK' | 'LATE' | ''; // Trichome stage: clear/cloudy/amber
    trimMethod?: 'WET' | 'DRY' | ''; // GACP: Wet trim vs Dry trim

    // Drying (GACP Critical)
    dryingMethod: 'SUN' | 'OVEN' | 'DEHYDRATOR' | 'GREENHOUSE' | 'HANGING' | 'RACK' | 'OTHER' | '';
    dryingDetail?: string; // If OTHER
    dryingDays?: string; // DTAM: จำนวนวันที่ตาก (5-15 days standard)
    dryingTemperature?: string; // GACP: 15-21°C recommended
    dryingHumidity?: string; // GACP: 45-55% RH
    dryingDarkRoom?: boolean; // GACP: ต้องมืด (ป้องกัน THC degradation)
    dryingAirflow?: 'NATURAL' | 'FAN_INDIRECT' | 'HVAC' | ''; // GACP: พัดลมไม่ส่งตรง

    // Curing (GACP Critical - ขาดอยู่!)
    hasCuringProcess?: boolean; // มีการบ่มหรือไม่
    curingDuration?: string; // 2-8 weeks
    curingTemperature?: string; // 15-21°C
    curingHumidity?: string; // 55-65% RH
    curingContainerType?: 'GLASS_JAR' | 'VACUUM_BAG' | 'NITROGEN_BAG' | 'HUMIDITY_CONTROLLED' | 'OTHER' | '';
    curingBurpFrequency?: 'DAILY' | 'TWICE_DAILY' | 'WEEKLY' | ''; // การเปิดภาชนะ

    // Storage
    storageSystem: 'CONTROLLED' | 'AMBIENT' | 'SILO' | '';
    temperatureControl?: string; // DTAM: อุณหภูมิที่ควบคุม (if CONTROLLED)
    storageHumidity?: string; // ความชื้นในที่เก็บ

    // Packaging
    packaging: string;
    packagingType?: 'VACUUM' | 'FOOD_GRADE' | 'FOIL' | 'AIR_TIGHT' | 'OTHER' | ''; // DTAM: ประเภทบรรจุภัณฑ์
    qualityControlChecks?: string[]; // Selected GACP quality-control measures (step 5)
    qualityControlLabels?: string[]; // Human-readable labels for preview/review rendering
}

// [NEW] Cultivation Details for dynamic form based on method
export interface CultivationDetails {
    methods: MainCultivationType[];  // Support multiple cultivation methods
    strainId: string;
    strainName?: string;
    // DTAM: แหล่งที่มาสายพันธุ์
    strainSource?: string; // แหล่งที่มา
    strainVATDoc?: string; // เอกสาร ภพ.4
    // DTAM: วัสดุปลูก (ไม่ล็อค, รองรับ aeroponics)
    plantingMaterial?: string; // เช่น ดิน, ไฮโดรโปนิกส์, แอโรโปนิกส์
    // DTAM: ทะเบียนปุ๋ย
    fertilizerInfo?: string; // ชื่อปุ๋ย/ทะเบียน
    // For outdoor/ground
    plantsPerRai?: number;
    plantSpacing?: string;
    // For greenhouse
    greenhouseCount?: number;
    greenhouseSize?: string;
    // For vertical/rack
    rackLayers?: number;
    racksPerLayer?: number;
    plantsPerRack?: number;
    // For hydroponic
    hydroSystem?: 'NFT' | 'DWC' | 'DRIP';
    potCount?: number;
    // Common
    totalPlants: number;
    plantingDate: string; // ISO date
    estimatedHarvestDate?: string; // ISO date
    harvestCyclesPerYear?: number;
    estimatedYieldPerCycle?: number; // kg

    // IPM - Integrated Pest Management (GACP Mandatory!)
    hasIPMPlan?: boolean;
    ipmMethods?: ('BIOLOGICAL' | 'MECHANICAL' | 'CULTURAL' | 'CHEMICAL')[]; // วิธีการ
    beneficialInsects?: string; // แมลงศัตร์ธรรมชาติที่ใช้
    pesticides?: string; // สารกำจัดศัตรูพืช (ถ้ามี) + เลขทะเบียน
    pesticideFreeDays?: number; // วันงดใช้สารก่อนเก็บเกี่ยว
    monitoringFrequency?: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | ''; // ความถี่ตรวจศัตรูพืช

    // Indoor/Controlled Environment (for INDOOR, INDOOR_CONTROLLED, VERTICAL_RACK)
    hasEnvironmentControl?: boolean;
    hvacSystem?: 'SPLIT_AC' | 'CENTRAL_AC' | 'EVAP_COOLER' | 'NONE' | ''; // ระบบ HVAC
    hvacBrand?: string; // ยี่ห้อ/รุ่น
    temperatureRange?: string; // ช่วงอุณหภูมิ เช่น "18-26°C"
    humidityControl?: 'DEHUMIDIFIER' | 'HUMIDIFIER' | 'BOTH' | 'NONE' | ''; // ระบบควบคุมความชื้น
    targetHumidity?: string; // ความชื้นเป้าหมาย เช่น "45-55%"
    co2Supplementation?: boolean; // มีการเสริม CO2
    co2Level?: string; // ระดับ CO2 เช่น "800-1200 ppm"
    co2Source?: 'TANK' | 'GENERATOR' | 'NONE' | ''; // แหล่ง CO2
    lightType?: 'LED' | 'HPS' | 'CMH' | 'FLUORESCENT' | 'NATURAL' | ''; // ประเภทแสง
    lightSchedule?: string; // ตารางแสง เช่น "18/6" หรือ "12/12"
    lightIntensity?: string; // ความเข้มแสง เช่น "600-1000 PPFD"
}

// Phase 6: Track & Trace Interfaces

// Consumer Effect Tracking - ติดตามผลการใช้งานจากผู้บริโภค
export interface ConsumerFeedback {
    id: string;
    batchId: string; // รหัส Lot ที่ขาย
    qrCode: string; // QR ที่สแกน
    submittedAt: string; // ISO date
    effectType: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'ADVERSE'; // ประเภทผล
    symptoms?: string[]; // อาการ (ถ้าเป็น negative/adverse)
    rating: number; // 1-5
    comment?: string; // ความคิดเห็น
    contactAllowed?: boolean; // ยินยอมให้ติดต่อกลับ
    contactInfo?: string; // เบอร์โทร/อีเมล (ถ้ายินยอม)
}

// Post-Audit Image Upload - อัปโหลดภาพหลังตรวจ
export interface PostAuditTask {
    id: string;
    auditId: string; // รหัสการตรวจ
    taskType: 'CORRECTIVE_ACTION' | 'ADDITIONAL_IMAGE' | 'DOCUMENTATION' | 'VERIFICATION';
    title: string;
    description: string;
    assignedAt: string; // ISO date - วันที่ได้รับมอบหมาย
    deadline: string; // ISO date - กำหนดส่ง
    status: 'PENDING' | 'UPLOADED' | 'APPROVED' | 'REJECTED' | 'OVERDUE';
    files?: {
        fileName: string;
        fileUrl: string;
        uploadedAt: string;
    }[];
    auditorNote?: string; // หมายเหตุจากผู้ตรวจ
    completedAt?: string; // วันที่ส่งงาน
}

// 5-Day Revision Deadline Tracking
export interface RevisionDeadline {
    applicationId: string;
    revisionNumber: number; // ครั้งที่แก้ไข
    issuedAt: string; // วันที่แจ้ง
    deadline: string; // กำหนดส่ง (issuedAt + 5 วัน)
    status: 'ACTIVE' | 'COMPLETED' | 'EXTENDED' | 'OVERDUE';
    requiredChanges: string[]; // รายการที่ต้องแก้ไข
    completedChanges?: string[]; // รายการที่แก้ไขแล้ว
    extensionReason?: string; // เหตุผลขอขยายเวลา (ถ้ามี)
    submittedAt?: string; // วันที่ส่งแก้ไข
}

// [NEW] QR Tracking Data per plant
export interface PlantTrackingData {
    plantId: string;
    qrCode?: string;
    plantingDate: string;
    actualHarvestDate?: string;
    status: 'PLANTED' | 'GROWING' | 'HARVESTED' | 'DESTROYED';
}

// [NEW] Per-step documents (inline uploads)
export interface StepDocument {
    stepNumber: number;
    docType: string;
    fileName?: string;
    fileUrl?: string;
    uploadedAt?: string;
    required: boolean;
}

export interface DocumentUpload {
    id: string;
    name?: string;
    type?: string;
    url?: string;
    uploaded: boolean;
    metadata?: unknown; // [NEW] For storing extracted data (e.g., Land Area)
}
