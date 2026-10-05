'use client';


import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/primitives/button';
import { Input } from '@/components/ui/primitives/input';
import { Select } from '@/components/ui/select';
import { DateInput } from '@/components/ui/date-input';
import { Icons } from '@/components/ui/icons';
import { PageContainer } from '@/components/layout/page-system';
import {
  plantingService,
  type CertificateOption,
  type FarmOption,
  type PlantSpeciesOption,
  type PlotOption,
} from '@/lib/services/planting-service';
import { toPlantingUserMessage } from '@/lib/planting-labels';
import { NewPlantingCyclePlotAssignment } from './new-planting-cycle-plot-assignment';
import { NewPlantingCycleSummary } from './new-planting-cycle-summary';
import { plotAreaSqm, suggestPlantCount, pickDefaultPlantSpeciesId, type PlotAssignmentForm } from './new-planting-cycle-page-config';
import { submitNewPlantingCycle } from './new-planting-cycle-submit';

export default function NewPlantingCyclePage() {
  const router = useRouter();

  const [_loading, setLoading] = useState(true);
  // เคยชื่อ _loadingPlots — ธงถูกตั้งทุกครั้งแต่ไม่มีใครอ่าน จึงเกิดคำเตือนเท็จระหว่างโหลด
  const [loadingPlots, setLoadingPlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [farms, setFarms] = useState<FarmOption[]>([]);
  const [plots, setPlots] = useState<PlotOption[]>([]);
  // ขอบเขตที่ใบรับรองครอบคลุม · null = ยังไม่มีใบ ⇒ หน้าจอไม่กั้นอะไร
  const [certifiedAreaTypes, setCertifiedAreaTypes] = useState<string[] | null>(null);
  const [plants, setPlants] = useState<PlantSpeciesOption[]>([]);
  const [certificates, setCertificates] = useState<CertificateOption[]>([]);

  const [farmId, setFarmId] = useState('');
  const [certificateId, setCertificateId] = useState('');
  const [plantSpeciesId, setPlantSpeciesId] = useState('');
  const [cycleName, setCycleName] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(new Date());
  const [expectedHarvestDate, setExpectedHarvestDate] = useState<Date | null>(null);
  const [seedSource, setSeedSource] = useState('');
  const [notes, setNotes] = useState('');

  const [selectedPlotIds, setSelectedPlotIds] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<Record<string, PlotAssignmentForm>>({});

  useEffect(() => {
    const loadMaster = async () => {
      setLoading(true);
      setError(null);

      const [farmResult, plantResult, certResult] = await Promise.all([
        plantingService.getFarms(),
        plantingService.getPlantSpecies(),
        plantingService.getMyCertificates().catch(() => ({
          success: false,
          error: 'ไม่สามารถโหลดข้อมูลใบรับรอง',
          data: [] as CertificateOption[],
        })),
      ]);

      if (!farmResult.success) {
        setError(toPlantingUserMessage(farmResult.error || 'ไม่สามารถโหลดรายการฟาร์มได้'));
        setLoading(false);
        return;
      }

      if (!plantResult.success) {
        setError(toPlantingUserMessage(plantResult.error || 'ไม่สามารถโหลดรายการชนิดพืชได้'));
        setLoading(false);
        return;
      }

      const farmRows = farmResult.data;
      const plantRows = plantResult.data;
      const certificateRows = Array.isArray(certResult.data) ? certResult.data : [];

      const activeCertificates = certificateRows.filter((item) => {
        const canonical = String(item.canonicalStatus || item.status || '').toLowerCase();
        if (canonical !== 'active') {
          return false;
        }
        if (!item.expiryDate) {
          return true;
        }
        return new Date(item.expiryDate).getTime() >= Date.now();
      });
      const eligibleFarmIds = new Set(
        activeCertificates
          .map((item) => String(item.farmId || '').trim())
          .filter(Boolean),
      );
      const eligibleFarms = farmRows.filter((farm) => eligibleFarmIds.has(String(farm.id || '').trim()));

      setFarms(eligibleFarms);
      setPlants(plantRows);
      setCertificates(certificateRows);

      if (eligibleFarms[0]) {
        setFarmId(eligibleFarms[0].id);
      } else {
        setFarmId('');
      }

      // เคยเทียบ `item.code === 'cannabis'` ซึ่งเป็น slug ของวิซาร์ด ไม่ใช่รหัสทะเบียน (`CAN`)
      // ที่ /api/plants คืนมา ⇒ ไม่เคยตรง และตกไปที่แถวแรกเสมอ (บังเอิญเป็นกัญชาอยู่)
      setPlantSpeciesId(pickDefaultPlantSpeciesId(plantRows));

      if (activeCertificates[0]) {
        setCertificateId(String(activeCertificates[0].id || activeCertificates[0].id || ''));
      }

      setLoading(false);
    };

    loadMaster();
  }, []);

  useEffect(() => {
    const loadPlots = async () => {
      if (!farmId) {
        setPlots([]);
        setCertifiedAreaTypes(null);
        setSelectedPlotIds([]);
        setAssignments({});
        return;
      }

      setLoadingPlots(true);
      setError(null);

      const result = await plantingService.getFarmPlots(farmId);
      if (!result.success) {
        setError(toPlantingUserMessage(result.error || 'ไม่สามารถโหลดแปลงปลูกได้'));
        setPlots([]);
        setSelectedPlotIds([]);
        setAssignments({});
        setLoadingPlots(false);
        return;
      }

      setPlots(result.data);
      setCertifiedAreaTypes(result.certifiedAreaTypes);
      setSelectedPlotIds([]);
      setAssignments({});
      setLoadingPlots(false);
    };

    loadPlots();
  }, [farmId]);

  const activeCertificates = useMemo(() => {
    return certificates.filter((item) => {
      const certificateFarmId = String(item.farmId || '').trim();
      if (certificateFarmId && farmId && certificateFarmId !== farmId) {
        return false;
      }
      const canonical = String(item.canonicalStatus || item.status || '').toLowerCase();
      if (canonical !== 'active') {
        return false;
      }
      if (!item.expiryDate) {
        return true;
      }
      return new Date(item.expiryDate).getTime() >= Date.now();
    });
  }, [certificates, farmId]);
  const hasActiveCertificateForFarm = activeCertificates.length > 0;

  useEffect(() => {
    if (!certificateId && activeCertificates[0]) {
      setCertificateId(String(activeCertificates[0].id || activeCertificates[0].id || ''));
      return;
    }

    if (certificateId && activeCertificates.every((item) => String(item.id || '') !== certificateId)) {
      setCertificateId(activeCertificates[0] ? String(activeCertificates[0].id || activeCertificates[0].id || '') : '');
    }
  }, [activeCertificates, certificateId]);

  const methods = useMemo(() => {
    const selected = plots.filter((plot) => selectedPlotIds.includes(plot.id));
    return Array.from(new Set(selected.map((plot) => plot.solarSystem).filter(Boolean)));
  }, [plots, selectedPlotIds]);

  const summary = useMemo(() => {
    const totalAreaSqm = selectedPlotIds.reduce((sum, plotId) => sum + Number(assignments[plotId]?.allocatedAreaSqm || 0), 0);
    const totalPlants = selectedPlotIds.reduce((sum, plotId) => sum + Number(assignments[plotId]?.plannedPlantCount || 0), 0);
    return {
      totalAreaSqm,
      totalPlants,
      plotCount: selectedPlotIds.length,
    };
  }, [assignments, selectedPlotIds]);

  const submitBlockers = useMemo(() => {
    const blockers: string[] = [];
    if (!farmId) {
      blockers.push('ยังไม่ได้เลือกฟาร์ม');
    }
    if (!certificateId) {
      blockers.push('ยังไม่ได้เลือกใบรับรองที่ใช้งานได้');
    }
    if (!hasActiveCertificateForFarm) {
      blockers.push('ฟาร์มนี้ไม่มีใบรับรองที่ใช้งานได้');
    }
    if (!plantSpeciesId) {
      blockers.push('ยังไม่ได้เลือกชนิดพืช');
    }
    if (!cycleName.trim()) {
      blockers.push('ยังไม่ได้กรอกชื่อรอบปลูก');
    }
    if (!startDate) {
      blockers.push('ยังไม่ได้ระบุวันเริ่มปลูก');
    }
    if (selectedPlotIds.length < 1) {
      blockers.push('ต้องเลือกแปลงอย่างน้อย 1 แปลง');
    }
    return blockers;
  }, [
    certificateId,
    cycleName,
    farmId,
    hasActiveCertificateForFarm,
    plantSpeciesId,
    selectedPlotIds.length,
    startDate,
  ]);

  const onTogglePlot = (plot: PlotOption, checked: boolean) => {
    if (checked) {
      const areaSqm = plotAreaSqm(plot);
      const suggestedPlants = suggestPlantCount(areaSqm, plot.solarSystem);
      setSelectedPlotIds((prev) => Array.from(new Set([...prev, plot.id])));
      setAssignments((prev) => ({
        ...prev,
        [plot.id]: {
          allocatedAreaSqm: Math.round(areaSqm * 100) / 100,
          plannedPlantCount: suggestedPlants,
        },
      }));
      return;
    }

    setSelectedPlotIds((prev) => prev.filter((plotId) => plotId !== plot.id));
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[plot.id];
      return next;
    });
  };

  const onSubmit = async () => {
    await submitNewPlantingCycle({
      farmId,
      certificateId,
      plantSpeciesId,
      cycleName,
      startDate,
      expectedHarvestDate,
      selectedPlotIds,
      plots,
      assignments,
      seedSource,
      notes,
      router,
      setError,
      setSubmitting,
    });
  };
  // PC-first: fill the DashboardLayout shell (max-w-6xl) via the standard
  // PageContainer instead of the old max-w-sm (384px) straw that left the form
  // a tiny column on desktop. The stray bg-white/50 overlay (dead loading
  // chrome that permanently dimmed the card) was removed in the same pass.
  return (
    <PageContainer>
      <div className="form-panel flex flex-col gap-5">
          <div className="flex flex-wrap items-center">
            <div className="flex flex-col">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icons.Plant size={20} />
                </div>
                <h2 className="text-xl font-semibold text-foreground">เพิ่มรอบจากแปลงเดิม</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                กระบวนการมาตรฐาน: เลือกฟาร์มที่มีใบรับรอง → เลือกแปลงและโควตา → ตั้งค่ารอบปลูก → ยืนยันสรุป
              </p>
            </div>
            <Button variant="default" onClick={() => router.push('/health/planting')}>กลับหน้ารอบปลูก</Button>
          </div>

          {error && (
            <Alert color="red" title="ไม่สามารถดำเนินการได้" icon={<Icons.AlertCircle size={16} />}>
              {error}
            </Alert>
          )}

          <Alert color="blue" title="กติกาการเปิดรอบปลูก (โปร่งใสและตรวจสอบได้)">
            1) ต้องมีใบรับรองที่ยังใช้งานได้ก่อนเปิดรอบปลูก 2) รอบปลูกใช้ข้อมูลแปลงจริงและพื้นที่ตร.ม.เท่านั้น
            3) ระบบออก QR ให้ทุกแปลงในรอบเพื่อใช้ตรวจย้อนกลับ 4) ทุกขั้นตอนถูกบันทึกเพื่อใช้ตรวจย้อนหลัง
          </Alert>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="ฟาร์ม"
              placeholder="เลือกฟาร์ม"
              value={farmId || undefined}
              onChange={(value) => setFarmId(String(value || ''))}
              data={farms.map((farm) => ({
                value: farm.id,
                // ชื่อฟาร์มซ้ำกันได้จริง (วัดบน demo: สองแถวชื่อเดียวกัน) — อำเภอ/จังหวัด
                // ทำให้สองตัวเลือกแยกออกจากกันด้วยตา ไม่ใช่ด้วยการเดา
                label: [farm.farmName || farm.id,
                  [farm.district, farm.province].filter(Boolean).join(', ')]
                  .filter(Boolean).join(' · '),
              }))}

              required
            />
            <Select
              label="ใบรับรองที่ใช้งานได้"
              placeholder={activeCertificates.length > 0 ? 'เลือกใบรับรอง' : 'ยังไม่มีใบรับรองที่ใช้งานได้'}
              value={certificateId || undefined}
              onChange={(value) => setCertificateId(String(value || ''))}
              data={activeCertificates.map((certificate) => ({
                value: String(certificate.id || ''),
                label: `${certificate.certificateNumber || 'CERT'}${certificate.siteName ? ` - ${certificate.siteName}` : ''}`,
              }))}


              description={activeCertificates.length > 0
                ? 'ต้องใช้ใบรับรองที่ยังมีผล เพื่อให้ระบบสร้าง QR รายแปลงและบันทึกเก็บเกี่ยวได้'
                : 'ไม่พบใบรับรองที่ใช้งานได้ของฟาร์มนี้ จึงยังไม่สามารถเปิดรอบปลูกได้'}
            />
            <Select
              label="ชนิดพืช"
              placeholder="เลือกชนิดพืช"
              value={plantSpeciesId || undefined}
              onChange={(value) => setPlantSpeciesId(String(value || ''))}
              data={plants.map((plant) => ({
                value: plant.id,
                label: plant.nameTH || plant.nameEN || plant.code || plant.id,
              }))}

              required
            />
          </div>

          {farms.length === 0 && (
            <Alert color="yellow" title="ยังไม่มีฟาร์มที่พร้อมเปิดรอบปลูก">
              ระบบจะแสดงเฉพาะฟาร์มที่มีใบรับรองใช้งานได้และมีแปลงปลูกอย่างน้อย 1 แปลง
            </Alert>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="ชื่อรอบปลูก"
              placeholder="เช่น รอบฤดูฝน 2569"
              value={cycleName}
              onChange={(event) => setCycleName(event.currentTarget.value)}
              required
            />
            <DateInput
              label="วันเริ่มปลูก"
              value={startDate}
              onChange={setStartDate}
              required
            />
            <DateInput
              label="วันคาดเก็บเกี่ยว"
              value={expectedHarvestDate}
              onChange={setExpectedHarvestDate}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="แหล่งที่มาพันธุ์พืช (ถ้ามี)"
              value={seedSource}
              onChange={(event) => setSeedSource(event.currentTarget.value)}
            />
          </div>

          {!hasActiveCertificateForFarm && (
            <Alert color="yellow" title="ยังเปิดรอบปลูกไม่ได้">
              ฟาร์มนี้ยังไม่มีใบรับรองที่ใช้งานได้ กรุณาดำเนินการรับรองหรือเลือกฟาร์มที่มีใบรับรองก่อน
            </Alert>
          )}

          <NewPlantingCyclePlotAssignment
            plots={plots}
            certifiedAreaTypes={certifiedAreaTypes}
            loading={loadingPlots}
            farmId={farmId}
            selectedPlotIds={selectedPlotIds}
            assignments={assignments}
            onTogglePlot={onTogglePlot}
            onAllocatedAreaChange={(plot, nextArea) => {
              setAssignments((prev) => ({
                ...prev,
                [plot.id]: {
                  allocatedAreaSqm: nextArea,
                  plannedPlantCount: prev[plot.id]?.plannedPlantCount || suggestPlantCount(nextArea, plot.solarSystem),
                },
              }));
            }}
            onPlantCountChange={(plot, nextCount) => {
              setAssignments((prev) => ({
                ...prev,
                [plot.id]: {
                  allocatedAreaSqm: prev[plot.id]?.allocatedAreaSqm || 0,
                  plannedPlantCount: nextCount,
                },
              }));
            }}
          />

          <NewPlantingCycleSummary
            methods={methods}
            summary={summary}
            submitBlockers={submitBlockers}
            notes={notes}
            onNotesChange={setNotes}
            onCancel={() => router.push('/health/planting')}
            onSubmit={onSubmit}
            submitting={submitting}
          />
      </div>
    </PageContainer>
  );
}


