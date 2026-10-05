'use client';

import { useState } from 'react';
import { Table } from '@/components/ui/primitives/table';
import { Icons } from '@/components/ui/icons';
import { Image } from '@/components/ui/data-components';
import { apiClient } from '@/lib/api/api-client';
import { AREA_UNIT_LABEL } from '@/lib/area';
import {
  getApplicantDisplayName,
  isImageFileUrl,
  isPdfFileUrl,
  PLANT_NAMES,
  REQUIRED_DOCUMENTS,
  type ApplicationData,
  asRecord,
  asString,
  withFallback,
  joinParts,
  mapApplicantType,
  mapServiceType,
  mapPurpose,
  mapMethod,
  mapHarvestMethod,
  mapDryingMethod,
  mapStorageSystem,
  mapIrrigation,
  mapPlantParts,
  mapWaterSource,
  mapFiltration,
  mapLandOwnership,
  mapLandDocument,
  mapPropagation,
  mapPlantingMaterial,
  mapSoilType,
  mapStrain,
  mapSeedSourceType,
  mapMaturity,
  mapTrim,
  mapAirflow,
  mapCuringContainer,
  mapBurp,
  mapPackaging,
  mapInputType,
  mapIpmMethods,
  mapHasFlag,
  mapQualityControl,
} from '@/components/application/application-document-helpers';
import {
  EDITABLE_FIELD_CONFIG,
  buildDraftFromFormData,
  buildChangesPatch,
  getDraftValue,
  setDraftValue,
  type EditDraft,
  type EditableField,
  type EditableSection,
} from '@/components/application/application-document-edit-config';
import { safeSrc } from '@/lib/safe-url';

type InfoItemProps = {
  label: string;
  value: string;
};

function InfoItem({ label, value }: InfoItemProps) {
  // print:break-inside-avoid keeps each field card whole — never split a box
  // across a page break when printing the multi-page document.
  return (
    <div className="print:print-color-exact rounded-xl border border-border/70 bg-card px-3 py-2 print:break-inside-avoid">
      <p className="text-xs font-medium text-primary/80">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-foreground">{value || '-'}</p>
    </div>
  );
}

/**
 * Editable variant of InfoItem — renders the same card chrome but with an
 * input/select/checkbox bound to the draft. Used ONLY when the document is in
 * reviewer edit mode; the read-only path stays byte-for-byte identical.
 */
function EditableInfoItem({
  field,
  draft,
  onChange,
}: {
  field: EditableField;
  draft: EditDraft;
  onChange: (next: EditDraft) => void;
}) {
  const raw = getDraftValue(draft, field.section, field.path);

  if (field.type === 'boolean') {
    const checked = raw === true;
    return (
      <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-primary/30 bg-card px-3 py-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(setDraftValue(draft, field.section, field.path, event.target.checked))}
          className="h-4 w-4 accent-primary"
        />
        <span className="text-xs font-medium text-primary/80">{field.label}</span>
      </label>
    );
  }

  const stringValue = raw === null || raw === undefined ? '' : String(raw);

  return (
    <div className="rounded-xl border border-primary/30 bg-card px-3 py-2">
      <p className="text-xs font-medium text-primary/80">{field.label}</p>
      {field.type === 'select' ? (
        <select
          aria-label={field.label}
          value={stringValue}
          onChange={(event) => onChange(setDraftValue(draft, field.section, field.path, event.target.value || null))}
          className="mt-0.5 w-full rounded-lg border border-border bg-card px-2 py-1 text-sm font-semibold text-foreground"
        >
          <option value="">- ไม่ระบุ -</option>
          {(field.options || []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          aria-label={field.label}
          type={field.type === 'number' ? 'number' : 'text'}
          value={stringValue}
          onChange={(event) =>
            onChange(
              setDraftValue(
                draft,
                field.section,
                field.path,
                field.type === 'number'
                  ? (event.target.value === '' ? null : Number(event.target.value))
                  : event.target.value,
              ),
            )
          }
          className="mt-0.5 w-full rounded-lg border border-border bg-card px-2 py-1 text-sm font-semibold text-foreground"
        />
      )}
    </div>
  );
}

/** Document-style section heading: leaf-green accent bar + tinted background. */
function SectionHeading({ children }: { children: string }) {
  // print:break-after-avoid stops a heading being orphaned at the page bottom
  // (it stays with the content that follows).
  return (
    <h3 className="print:print-color-exact flex items-center gap-2 rounded-r-lg border-l-4 border-primary bg-primary/10 px-3 py-2 text-base font-semibold text-foreground print:break-after-avoid">
      {children}
    </h3>
  );
}

/** Editable grid for one section — rendered in place of the read-only grid
 *  when the reviewer is in edit mode. */
function EditableSectionGrid({
  section,
  draft,
  onChange,
}: {
  section: EditableSection;
  draft: EditDraft;
  onChange: (next: EditDraft) => void;
}) {
  const fields = EDITABLE_FIELD_CONFIG.filter((field) => field.section === section);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {fields.map((field) => (
        <EditableInfoItem key={`${field.section}.${field.path}`} field={field} draft={draft} onChange={onChange} />
      ))}
    </div>
  );
}

/**
 * Full 9-section GACP application document (letterhead + sections 1–9 +
 * supporting video).
 *
 * Shared between the applicant preview page and the provider review page. In
 * its default (read-only) mode both surfaces show byte-for-byte the same
 * document — DO NOT change the read-only visual output.
 *
 * When `editable` is true (provider review only), a "แก้ไขข้อมูล" button lets
 * the assigned reviewer flip the §1/§3/§4/§7 scalar+enum fields into editable
 * controls and save them in place via PATCH …/form-fields. Arrays/tables stay
 * read-only in V1. `editable` defaults to false so the applicant preview is
 * unaffected.
 */
export function ApplicationDocumentView({
  application,
  editable = false,
  onSaved,
}: {
  application: ApplicationData;
  editable?: boolean;
  onSaved?: () => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const enterEditMode = () => {
    setDraft(buildDraftFromFormData(application.formData));
    setSaveError(null);
    setEditMode(true);
  };

  const cancelEdit = () => {
    setEditMode(false);
    setDraft(null);
    setSaveError(null);
  };

  const saveEdit = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const changes = buildChangesPatch(draft);
      const result = await apiClient.patch<unknown>(
        `/api/provider/applications/${encodeURIComponent(application.id)}/form-fields`,
        { changes },
      );
      if (!result?.success) {
        throw new Error(result?.error || 'บันทึกข้อมูลไม่สำเร็จ');
      }
      setEditMode(false);
      setDraft(null);
      onSaved?.();
    } catch (error) {
      // Inline error only — never blank the document view.
      setSaveError(error instanceof Error ? error.message : 'บันทึกข้อมูลไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  // editMode can only be entered when `editable` is true; the draft is the
  // single signal the per-section render branches read.
  const isEditing = editMode && draft !== null;
  const activeDraft = draft as EditDraft;

  const formData = asRecord(application.formData);
  const applicantData = asRecord(formData.applicantData);
  const farmData = asRecord(formData.farmData || formData.siteData);
  // Production step. Newer apps store it under formData.productionData; some
  // store the production-ish data under cultivationDetails. Either way, the
  // irrigation system is ALSO held on farmData.waterSourceDetail (the farm
  // step), so the preview falls back there (2026-06-25: irrigation showed "-"
  // although it was filled, because the preview only read productionData).
  const productionData = asRecord(formData.productionData || formData.cultivationDetails);
  const waterSourceDetail = asRecord(farmData.waterSourceDetail);
  const harvestData = asRecord(formData.harvestData);
  const landDocuments = asRecord(farmData.landDocuments);
  const landDocChecks = asRecord(landDocuments.checks);
  const selectedLandDocs = Object.entries(landDocChecks)
    .filter(([, v]) => v === true)
    .map(([k]) => mapLandDocument(k))
    .filter((label) => label !== '-');
  const seedSources = (Array.isArray(productionData.seedSources)
    ? (productionData.seedSources as Array<Record<string, unknown>>)
    : Array.isArray(productionData.varieties)
      ? (productionData.varieties as Array<Record<string, unknown>>)
      : []);
  const productionInputs = Array.isArray(productionData.productionInputs)
    ? (productionData.productionInputs as Array<Record<string, unknown>>)
    : [];
  const securityFeatures = [
    farmData.hasFence ? 'รั้วปิดล้อม' : '',
    farmData.hasCCTV ? 'กล้องวงจรปิด (CCTV)' : '',
    farmData.hasAccessControl ? 'ควบคุมการเข้าออก' : '',
    farmData.hasWarningSign ? 'ป้ายเตือน' : '',
  ].filter(Boolean);
  const plots = Array.isArray(formData.plots)
    ? (formData.plots as Array<Record<string, unknown>>)
    : Array.isArray(farmData.plots)
      ? (farmData.plots as Array<Record<string, unknown>>)
      : [];
  const documents = Array.isArray(formData.documents)
    ? (formData.documents as Array<{ type?: string; id?: string; name?: string; url?: string; uploaded?: boolean }>)
    : [];

  const cultivationMethods = (() => {
    if (Array.isArray(formData.cultivationMethods)) {
      return (formData.cultivationMethods as unknown[])
        .map((item) => mapMethod(asString(item)))
        .filter(Boolean)
        .join(', ');
    }
    return mapMethod(asString(formData.cultivationMethod));
  })();


  function getDocUrl(key: string): string {
    const fromRoot = withFallback(formData[key]);
    if (fromRoot !== '-') return fromRoot;

    const fromApplicant = withFallback(applicantData[key]);
    if (fromApplicant !== '-') return fromApplicant;

    const fromFarm = withFallback(farmData[key]);
    if (fromFarm !== '-') return fromFarm;

    const fromDocumentList = documents.find((item) => item.type === key || item.id === key)?.url || '';
    return withFallback(fromDocumentList);
  }

  const requiredDocuments = REQUIRED_DOCUMENTS
    .map((document) => ({
      key: document.key,
      name: document.name,
      url: getDocUrl(document.key),
    }))
    .filter((item) => item.url !== '-');

  const additionalDocuments = documents
    .filter((item) => Boolean(item.url && item.uploaded))
    .map((item, index) => ({
      key: `extra-${index}`,
      name: item.name || `เอกสารเพิ่มเติม ${index + 1}`,
      url: withFallback(item.url),
    }))
    .filter((item) => item.url !== '-');

  const allDocuments = [...requiredDocuments, ...additionalDocuments];

  return (
    <section className="surface-panel p-5 sm:p-6">
      {/* Reviewer edit affordances — provider-only (editable=true). Never
          rendered in the applicant preview (editable defaults to false) and
          hidden from print/PDF. */}
      {editable ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden" data-testid="reviewer-edit-toolbar">
          <p className="text-xs font-medium text-muted-foreground">
            {isEditing
              ? 'กำลังแก้ไขข้อมูล แก้เฉพาะข้อมูลตัวอักษร/ตัวเลือก (ตาราง เช่น พันธุ์/ปัจจัยการผลิต แก้ไม่ได้ในเวอร์ชันนี้)'
              : 'ผู้ตรวจที่ได้รับมอบหมายสามารถแก้ไขข้อมูลคำขอในหน้านี้ได้'}
          </p>
          {!isEditing ? (
            <button
              type="button"
              onClick={enterEditMode}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              data-testid="reviewer-edit-start"
            >
              <Icons.Edit size={16} /> แก้ไขข้อมูล
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Letterhead — matches the official DTAM ใบเสนอราคา/ใบวางบิล header
          (logo + green กองกัญชาทางการแพทย์ org block + bordered doc-type box).
          Gov green (gov-green = #006633) mirrors the exact colour of
          quotation.html via the centralised Tailwind token. */}
      <div className="print:print-color-exact mb-5 flex flex-col items-start gap-4 border-b-2 border-gov-green pb-4 sm:flex-row">
        {/* eslint-disable-next-line @next/next/no-img-element -- static letterhead logo; next/image optimisation breaks print/PDF */}
        <img
          src="/images/gacpthai-logo.png"
          alt="ตราหน่วยงาน"
          className="h-16 w-16 flex-shrink-0 object-contain"
        />
        <div className="flex-1">
          <p className="text-base font-bold leading-tight text-gov-green">กองกัญชาทางการแพทย์</p>
          <p className="text-sm font-bold leading-tight text-gov-green">กรมการแพทย์แผนไทยและการแพทย์ทางเลือก</p>
          <p className="mt-1 text-xs leading-snug text-slate-600">
            88/23 หมู่ 4 ถนนติวานนท์ ตำบลตลาดขวัญ อำเภอเมือง จังหวัดนนทบุรี 11000
          </p>
          <p className="text-xs text-slate-500">โทรศัพท์ (02) 5647889 · อีเมล tdc.cannabis.gacp@gmail.com</p>
        </div>
        <div className="flex-shrink-0 text-center">
          <div className="rounded-md border-[1.5px] border-foreground px-4 py-2 text-base font-bold leading-tight text-foreground">
            คำขอรับรอง<br />มาตรฐาน GACP
          </div>
          <p className="mt-1 text-[10px] text-slate-500">แบบ กทล 1</p>
        </div>
      </div>

      <div className="flow-stack-lg">
        <article className="flow-stack-sm">
          <SectionHeading>1) ข้อมูลผู้ยื่นคำขอ</SectionHeading>
          {isEditing ? (
            <EditableSectionGrid section="applicantData" draft={activeDraft} onChange={setDraft} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <InfoItem label="ประเภทผู้ยื่น" value={mapApplicantType(applicantData.applicantType)} />
              <InfoItem label="ชื่อผู้ยื่น" value={getApplicantDisplayName(applicantData)} />
              <InfoItem label="โทรศัพท์" value={withFallback(applicantData.phone || applicantData.companyPhone || applicantData.presidentPhone)} />
              <InfoItem label="อีเมล" value={withFallback(applicantData.email)} />
              <InfoItem label="Line ID" value={withFallback(applicantData.lineId)} />
              <InfoItem label="เลขบัตรประชาชน/ทะเบียน" value={withFallback(applicantData.idCard || applicantData.presidentIdCard || applicantData.directorIdCard || applicantData.communityRegNumber)} />
              <InfoItem label="เลขประจำตัวผู้เสียภาษี/ทะเบียนนิติบุคคล" value={withFallback(applicantData.taxId || applicantData.registrationNumber)} />
              <InfoItem
                label="ที่อยู่ผู้ยื่น"
                value={withFallback(applicantData.address || applicantData.communityAddress || applicantData.companyAddress)}
              />
            </div>
          )}
        </article>

        <article className="flow-stack-sm">
          <SectionHeading>2) ข้อมูลพืชและวัตถุประสงค์</SectionHeading>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <InfoItem
              label="ชนิดพืช"
              value={PLANT_NAMES[asString(formData.plantId)] || withFallback(formData.plantName || formData.plantId)}
            />
            <InfoItem label="วัตถุประสงค์" value={
              Array.isArray(formData.certificationPurposes) && (formData.certificationPurposes as string[]).length > 0
                ? (formData.certificationPurposes as string[]).map((p) => mapPurpose(p)).join(', ')
                : mapPurpose(formData.certificationPurpose)
            } />
            <InfoItem label="วิธีปลูก" value={withFallback(cultivationMethods)} />
            <InfoItem label="ประเภทบริการ" value={mapServiceType(formData.serviceType)} />
          </div>
        </article>

        <article className="flow-stack-sm">
          <SectionHeading>3) ข้อมูลสถานประกอบการและแปลงปลูก</SectionHeading>
          {isEditing ? (
            <EditableSectionGrid section="farmData" draft={activeDraft} onChange={setDraft} />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <InfoItem label="ชื่อฟาร์ม/สถานที่" value={withFallback(farmData.farmName || farmData.siteName)} />
                <InfoItem
                  label="ที่อยู่"
                  value={joinParts([
                    farmData.address,
                    farmData.subdistrict,
                    farmData.district,
                    farmData.province,
                    farmData.postalCode,
                  ])}
                />
                <InfoItem label="พื้นที่รวม" value={`${withFallback(farmData.totalAreaSize || farmData.areaSize)} ${AREA_UNIT_LABEL}`} />
                <InfoItem
                  label="พิกัด GPS"
                  value={farmData.gpsLat && farmData.gpsLng ? `${farmData.gpsLat}, ${farmData.gpsLng}` : '-'}
                />
                <InfoItem label="การถือครองที่ดิน" value={mapLandOwnership(farmData.landOwnership)} />
                <InfoItem label="เอกสารสิทธิ์ที่ดิน" value={selectedLandDocs.length ? selectedLandDocs.join(', ') : '-'} />
              </div>

              <p className="pt-1 text-sm font-medium text-muted-foreground print:break-after-avoid">ระบบน้ำ ดิน และความปลอดภัย</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <InfoItem label="แหล่งน้ำ" value={mapWaterSource(waterSourceDetail.sourceType)} />
                <InfoItem label="การกรองน้ำ" value={mapFiltration(waterSourceDetail.filtrationTypes)} />
                <InfoItem label="ระบบให้น้ำ" value={mapIrrigation(waterSourceDetail.irrigationType || productionData.irrigationType)} />
                <InfoItem label="ผลตรวจคุณภาพน้ำ" value={mapHasFlag(waterSourceDetail.hasWaterTest)} />
                <InfoItem label="ชนิดดิน" value={mapSoilType(farmData.soilType || productionData.soilType)} />
                <InfoItem label="ค่า pH ดิน" value={withFallback(farmData.soilPH)} />
                <InfoItem label="ประวัติการใช้ที่ดิน" value={withFallback(farmData.soilHistory)} />
                <InfoItem label="ระบบรักษาความปลอดภัย" value={securityFeatures.length ? securityFeatures.join(', ') : '-'} />
              </div>
            </>
          )}

          {plots.length > 0 ? (
            <div className="mt-2 overflow-hidden rounded-2xl border border-border">
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>ชื่อแปลง</Table.Th>
                    <Table.Th>พื้นที่</Table.Th>
                    <Table.Th>รูปแบบปลูก</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {plots.map((plot, index) => (
                    <Table.Tr key={`plot-${index}`} className="print:break-inside-avoid">
                      <Table.Td>{withFallback(plot.name || `แปลง ${index + 1}`)}</Table.Td>
                      <Table.Td>{`${withFallback(plot.areaSize)} ${AREA_UNIT_LABEL}`}</Table.Td>
                      <Table.Td>{mapMethod(asString(plot.solarSystem || plot.cultivationMethod || '-'))}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          ) : (
            <div className="contrast-panel text-sm text-muted-foreground">ยังไม่มีข้อมูลแปลงปลูก</div>
          )}
        </article>

        <article className="flow-stack-sm">
          <SectionHeading>4) ข้อมูลการผลิต</SectionHeading>
          {isEditing ? (
            <EditableSectionGrid section="productionData" draft={activeDraft} onChange={setDraft} />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <InfoItem label="วิธีขยายพันธุ์" value={mapPropagation(productionData.propagationType)} />
                <InfoItem label="ส่วนของพืชที่เก็บเกี่ยว" value={mapPlantParts(productionData.plantParts)} />
                <InfoItem label="วัสดุปลูก" value={mapPlantingMaterial(productionData.plantingMaterial)} />
                <InfoItem label="ระยะปลูก" value={withFallback(productionData.plantSpacing)} />
                <InfoItem label="จำนวนต้น" value={withFallback(productionData.treeCount ?? productionData.plantCount)} />
                <InfoItem label="รอบเก็บเกี่ยว/ปี" value={withFallback(productionData.harvestCycles)} />
                <InfoItem label="ผลผลิตคาดการณ์ (กก./ปี)" value={withFallback(productionData.estimatedYield ?? productionData.annualProduction)} />
                <InfoItem label="วัตถุประสงค์ผลผลิต" value={withFallback(productionData.intendedUse)} />
                <InfoItem label="แผนจัดการศัตรูพืช (IPM)" value={mapHasFlag(productionData.hasIpmPlan)} />
                <InfoItem label="วิธี IPM" value={mapIpmMethods(productionData.ipmMethods)} />
                <InfoItem label="ใบรับรอง GAP" value={mapHasFlag(productionData.hasGAPCert)} />
                <InfoItem label="ใบรับรองอินทรีย์" value={mapHasFlag(productionData.hasOrganicCert)} />
              </div>
              {asString(productionData.ipmNote) ? (
                <InfoItem label="หมายเหตุ IPM" value={withFallback(productionData.ipmNote)} />
              ) : null}
            </>
          )}
        </article>

        {seedSources.length > 0 ? (
          <article className="flow-stack-sm">
            <SectionHeading>5) พันธุ์และแหล่งที่มาของเมล็ด/ส่วนขยายพันธุ์</SectionHeading>
            <div className="overflow-hidden rounded-2xl border border-border">
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>ชื่อพันธุ์</Table.Th>
                    <Table.Th>ประเภท</Table.Th>
                    <Table.Th>แหล่งที่มา</Table.Th>
                    <Table.Th>สายพันธุ์</Table.Th>
                    <Table.Th>ปริมาณ</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {seedSources.map((seed, index) => (
                    <Table.Tr key={`seed-${index}`} className="print:break-inside-avoid">
                      <Table.Td>{withFallback(seed.varietyName || seed.name)}</Table.Td>
                      <Table.Td>{mapSeedSourceType(seed.sourceType)}</Table.Td>
                      <Table.Td>{withFallback(seed.geoOrigin || seed.sourceName || seed.supplierName)}</Table.Td>
                      <Table.Td>{mapStrain(seed.strainType)}</Table.Td>
                      <Table.Td>{withFallback(seed.quantity)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          </article>
        ) : null}

        {productionInputs.length > 0 ? (
          <article className="flow-stack-sm">
            <SectionHeading>6) ปัจจัยการผลิต (ปุ๋ย/สารปรับปรุงดิน/สารป้องกันศัตรูพืช)</SectionHeading>
            <div className="overflow-hidden rounded-2xl border border-border">
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>ประเภท</Table.Th>
                    <Table.Th>ชื่อผลิตภัณฑ์</Table.Th>
                    <Table.Th>ยี่ห้อ</Table.Th>
                    <Table.Th>สูตร NPK</Table.Th>
                    <Table.Th>อินทรีย์</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {productionInputs.map((input, index) => (
                    <Table.Tr key={`input-${index}`} className="print:break-inside-avoid">
                      <Table.Td>{mapInputType(input.type)}</Table.Td>
                      <Table.Td>{withFallback(input.name)}</Table.Td>
                      <Table.Td>{withFallback(input.brandName)}</Table.Td>
                      <Table.Td>{withFallback(input.npkRatio)}</Table.Td>
                      <Table.Td>{mapHasFlag(input.isOrganic)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
          </article>
        ) : null}

        <article className="flow-stack-sm">
          <SectionHeading>7) การเก็บเกี่ยวและหลังการเก็บเกี่ยว</SectionHeading>
          {isEditing ? (
            <EditableSectionGrid section="harvestData" draft={activeDraft} onChange={setDraft} />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <InfoItem label="วิธีเก็บเกี่ยว" value={mapHarvestMethod(harvestData.harvestMethod)} />
                <InfoItem label="ระยะความสุก" value={mapMaturity(harvestData.harvestMaturity)} />
                <InfoItem label="วิธีตัดแต่ง" value={mapTrim(harvestData.trimMethod)} />
                <InfoItem label="วิธีทำแห้ง" value={mapDryingMethod(harvestData.dryingMethod)} />
                <InfoItem label="ระยะเวลาตาก" value={withFallback(harvestData.dryingDays)} />
                <InfoItem label="อุณหภูมิตาก" value={withFallback(harvestData.dryingTemperature)} />
                <InfoItem label="ความชื้นตาก" value={withFallback(harvestData.dryingHumidity)} />
                <InfoItem label="การไหลของอากาศ" value={mapAirflow(harvestData.dryingAirflow)} />
              </div>
              <p className="pt-1 text-sm font-medium text-muted-foreground print:break-after-avoid">การบ่ม การจัดเก็บ และบรรจุภัณฑ์</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <InfoItem label="มีการบ่ม (Curing)" value={mapHasFlag(harvestData.hasCuringProcess)} />
                {harvestData.hasCuringProcess === true ? (
                  <>
                    <InfoItem label="ระยะเวลาบ่ม" value={withFallback(harvestData.curingDuration)} />
                    <InfoItem label="อุณหภูมิบ่ม" value={withFallback(harvestData.curingTemperature)} />
                    <InfoItem label="ความชื้นบ่ม" value={withFallback(harvestData.curingHumidity)} />
                    <InfoItem label="ภาชนะบ่ม" value={mapCuringContainer(harvestData.curingContainerType)} />
                    <InfoItem label="ความถี่เปิดภาชนะ" value={mapBurp(harvestData.curingBurpFrequency)} />
                  </>
                ) : null}
                <InfoItem label="ระบบจัดเก็บ" value={mapStorageSystem(harvestData.storageSystem)} />
                <InfoItem label="ควบคุมอุณหภูมิจัดเก็บ" value={withFallback(harvestData.temperatureControl)} />
                <InfoItem label="ความชื้นในที่จัดเก็บ" value={withFallback(harvestData.storageHumidity)} />
                <InfoItem label="บรรจุภัณฑ์" value={harvestData.packaging || harvestData.packagingType ? mapPackaging(harvestData.packaging || harvestData.packagingType) : '-'} />
              </div>
            </>
          )}
        </article>

        <article className="flow-stack-sm">
          <SectionHeading>8) มาตรการควบคุมคุณภาพ (GACP)</SectionHeading>
          <InfoItem label="มาตรการที่ดำเนินการ" value={mapQualityControl(harvestData.qualityControlLabels, harvestData.qualityControlChecks)} />
        </article>

        <article className="flow-stack-sm">
          <SectionHeading>9) เอกสารประกอบ</SectionHeading>
          {allDocuments.length === 0 ? (
            <div className="contrast-panel text-sm text-muted-foreground">ยังไม่พบเอกสารแนบในคำขอนี้</div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {allDocuments.map((document) => (
                <div key={document.key} className="rounded-2xl border border-border bg-muted/20 p-3 print:break-inside-avoid">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">{document.name}</p>
                    <a
                      href={safeSrc(document.url)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-primary no-underline"
                    >
                      เปิดไฟล์
                    </a>
                  </div>

                  {isImageFileUrl(document.url) ? (
                    <Image src={safeSrc(document.url)} alt={document.name} className="h-44 w-full object-cover" />
                  ) : null}

                  {isPdfFileUrl(document.url) ? (
                    <div className="flow-stack-sm">
                      <div className="flex items-center gap-2 rounded-xl bg-card p-2 text-sm text-slate-700">
                        <Icons.FileText size={16} />
                        PDF document
                      </div>
                      <iframe
                        src={safeSrc(document.url)}
                        title={document.name}
                        className="hidden h-56 w-full rounded-xl border border-border md:block"
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          {(asString(formData.youtubeUrl) || asString(formData.videoLink)) ? (
            <div className="group-item mt-1">
              <p className="text-xs text-muted-foreground">วิดีโอประกอบ</p>
              <a
                href={safeSrc(asString(formData.youtubeUrl) || asString(formData.videoLink))}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-sm font-medium text-primary no-underline"
              >
                {asString(formData.youtubeUrl) || asString(formData.videoLink)}
              </a>
            </div>
          ) : null}
        </article>
      </div>

      {/* Sticky save/cancel bar — only while editing. print:hidden so it never
          appears on the PDF/print output. */}
      {isEditing ? (
        <div
          className="sticky bottom-0 z-10 mt-6 flex flex-col gap-2 rounded-2xl border border-primary/30 bg-card/95 p-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between print:hidden"
          data-testid="reviewer-edit-savebar"
        >
          <div className="min-h-[1.25rem] text-sm">
            {saveError ? (
              <span className="font-medium text-red-600" role="alert">{saveError}</span>
            ) : (
              <span className="text-muted-foreground">แก้ไขเสร็จแล้วกด &ldquo;บันทึก&rdquo; เพื่อบันทึกการเปลี่ยนแปลง</span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-60"
              data-testid="reviewer-edit-cancel"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={saveEdit}
              disabled={saving}
              className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              data-testid="reviewer-edit-save"
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-6 border-t border-border pt-4 text-center text-xs text-muted-foreground">
        เอกสารนี้สร้างจากระบบ GACP Online • พิมพ์เมื่อ {new Date().toLocaleString('th-TH')}
      </div>
    </section>
  );
}
