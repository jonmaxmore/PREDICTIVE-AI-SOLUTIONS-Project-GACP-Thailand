'use client';


import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { apiClient } from '@/lib/api';
import { Icons } from '@/components/ui/icons';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/primitives/tabs';
import { Alert } from '@/components/ui/alert';
import { SummaryHeader } from '@/components/feature';
import { AREA_UNIT_LABEL, formatAreaSqm, legacyAreaToSqm } from '@/lib/area';
// Reuse the Thai planting-cycle status labels the planting pages already
// use (health/planting/[id] detail view) instead of adding a second,
// divergent copy — this file only needs cycle.status → Thai label.
import { STATUS_META as CYCLE_STATUS_META } from '@/app/health/planting/[id]/planting-cycle-detail-page-config';
interface Farm {
    id: string;
    farmName: string;
    farmType: string;
    address: string;
    province: string;
    district: string;
    subDistrict: string;
    postalCode: string;
    totalArea: number;
    areaUnit: string;
    gpsLat?: string;
    gpsLng?: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    certificates?: Certificate[];
    plantingCycles?: PlantingCycle[];
}

interface Certificate {
    id: string;
    certificateNumber: string;
    status: string;
    issueDate: string;
    expiryDate: string;
}

interface PlantingCycle {
    id: string;
    cycleName: string;
    status: string;
    startDate: string;
}

const statusConfig: Record<string, { label: string; color: string }> = {
    DRAFT: { label: 'ฉบับร่าง', color: 'gray' },
    PENDING_VERIFICATION: { label: 'รอตรวจสอบ', color: 'yellow' },
    VERIFIED: { label: 'ยืนยันแล้ว', color: 'green' },
    ACTIVE: { label: 'ใช้งาน', color: 'green' },
    REJECTED: { label: 'ไม่ผ่าน', color: 'red' },
    SUSPENDED: { label: 'ระงับชั่วคราว', color: 'orange' },
};

const farmTypeConfig: Record<string, string> = {
    CULTIVATION: 'แปลงปลูก',
    PROCESSING: 'โรงแปรรูป',
    MIXED: 'ผสม',
};

export default function EstablishmentDetailPage() {
    const router = useRouter();
    const params = useParams();
    const id = params?.id as string;

    const [farm, setFarm] = useState<Farm | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (id) {
            loadFarm();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const loadFarm = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await apiClient.get<Farm>(`/farms/${id}`);
            // apiClient unwraps data.data, so result.data is already the Farm object
            if (result.success && result.data) {
                setFarm(result.data);
            } else {
                setError('ไม่พบข้อมูลแปลงนี้');
            }
        } catch {
            setError('เกิดข้อผิดพลาดในการโหลดข้อมูล');
        } finally {
            setLoading(false);
        }
    };

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('th-TH', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center">
                <Spinner color="green" size="xl" />
            </div>
        );
    }

    if (error || !farm) {
        return (
            <div className="mx-auto w-full max-w-lg px-4">
                <div className="flex flex-col items-center rounded-lg bg-card p-8 text-center shadow-sm">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
                        <Icons.AlertCircle size={28} />
                    </div>
                    <h2 className="mb-4 text-xl font-semibold text-slate-900">{error || 'ไม่พบข้อมูล'}</h2>
                    <Button href="/health/establishments" variant="default" size="md">
                        กลับหน้าแปลงปลูก
                    </Button>
                </div>
            </div>
        );
    }

    const status = statusConfig[farm.status] || statusConfig['DRAFT'] || { label: farm.status, color: 'gray' };

    return (
        // Wave E.2-B (detail-page extension): SummaryHeader replaces
        // inline header with farmName + Badge + farmType. Status badge
        // moves into the canonical actions slot. The suspicious
        // outer max-w-sm (384px) is bumped to max-w-6xl matching
        // detail-page convention — the previous narrow width forced
        // horizontal scrolling on the tabs panel below.
        <div className="space-y-4">
            <Button
                variant="ghost"
                color="gray"
                onClick={() => router.back()}
                size="compact-sm"
            >
                ย้อนกลับ
            </Button>
            <SummaryHeader
                eyebrow="ผู้ขอรับรอง · สถานประกอบการ"
                title={farm.farmName}
                description={`${farmTypeConfig[farm.farmType] || farm.farmType} • ${formatAreaSqm(legacyAreaToSqm(farm.totalArea, farm.areaUnit))} ${AREA_UNIT_LABEL}`}
                actions={
                    <Badge color={status.color}>
                        {status.label}
                    </Badge>
                }
            />

            <div className="flex flex-col gap-6">
                {/* Tabs */}
                <Tabs defaultValue="info" color="green">
                    <TabsList>
                        <TabsTrigger value="info">
                            ข้อมูลทั่วไป
                        </TabsTrigger>
                        <TabsTrigger value="certificates">
                            ใบรับรอง
                        </TabsTrigger>
                        <TabsTrigger value="cycles">
                            รอบการปลูก
                        </TabsTrigger>
                    </TabsList>

                    {/* Info Tab */}
                    <TabsContent value="info">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="rounded-lg bg-card p-5 shadow-sm">
                                <div className="mb-4 flex flex-wrap items-center gap-3">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
                                        <Icons.MapPin size={20} />
                                    </div>
                                    <p className="font-medium">ที่ตั้ง</p>
                                </div>
                                <div className="flex flex-col gap-3">
                                    <p className="text-sm">{farm.address}</p>
                                    <p className="text-sm text-slate-500">
                                        {farm.subDistrict}, {farm.district}, {farm.province} {farm.postalCode}
                                    </p>
                                    {farm.gpsLat && farm.gpsLng && (
                                        <p className="text-xs text-slate-500">
                                            พิกัด: {farm.gpsLat}, {farm.gpsLng}
                                        </p>
                                    )}
                                </div>

                                {/* Farm location.
                                    This used to embed an openstreetmap.org iframe whose src carried
                                    the farm's exact coordinates — so a foreign server received the
                                    precise location of a Thai farm on every page load, with no
                                    click required. Removed so no foreign server receives the farm's
                                    exact coordinates by default. The coordinates are shown as
                                    selectable text instead; when an
                                    in-country tile source is configured (NEXT_PUBLIC_MAP_TILE_URL)
                                    a rendered map can be reinstated through the shared
                                    InteractiveMap component, which draws only from that source. */}
                                {farm.gpsLat && farm.gpsLng && (
                                    <div className="mt-4 rounded-lg border border-border bg-card p-4">
                                        <p className="text-xs font-semibold text-muted-foreground">พิกัดที่ตั้งแปลง</p>
                                        <p className="mt-1 select-all text-sm font-medium tabular-nums text-foreground">
                                            {farm.gpsLat}, {farm.gpsLng}
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div className="rounded-lg bg-card p-5 shadow-sm">
                                <div className="mb-4 flex flex-wrap items-center gap-3">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
                                        <Icons.FileText size={20} />
                                    </div>
                                    <p className="font-medium">รายละเอียด</p>
                                </div>
                                <div className="flex flex-col gap-3">
                                    <div className="flex flex-wrap items-center">
                                        <p className="text-sm text-slate-500">ประเภท</p>
                                        <p className="text-sm font-medium">{farmTypeConfig[farm.farmType] || farm.farmType}</p>
                                    </div>
                                    <div className="flex flex-wrap items-center">
                                        <p className="text-sm text-slate-500">พื้นที่</p>
                                        <p className="text-sm font-medium">{formatAreaSqm(legacyAreaToSqm(farm.totalArea, farm.areaUnit))} {AREA_UNIT_LABEL}</p>
                                    </div>
                                    <div className="flex flex-wrap items-center">
                                        <p className="text-sm text-slate-500">สถานะ</p>
                                        <Badge color={status.color} >{status.label}</Badge>
                                    </div>
                                    <div className="flex flex-wrap items-center">
                                        <p className="text-sm text-slate-500">สร้างเมื่อ</p>
                                        <p className="text-sm">{formatDate(farm.createdAt)}</p>
                                    </div>
                                    <div className="flex flex-wrap items-center">
                                        <p className="text-sm text-slate-500">อัปเดตล่าสุด</p>
                                        <p className="text-sm">{formatDate(farm.updatedAt)}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </TabsContent>

                    {/* Certificates Tab */}
                    <TabsContent value="certificates">
                        {farm.certificates && farm.certificates.length > 0 ? (
                            <div className="grid grid-cols-2 gap-4">
                                {farm.certificates.map(cert => (
                                    <div className="rounded-lg bg-card p-5 shadow-sm" key={cert.id}>
                                        <div className="mb-3 flex flex-wrap items-center">
                                            <p className="font-medium">{cert.certificateNumber}</p>
                                            <Badge color={cert.status === 'ACTIVE' ? 'green' : 'gray'} >
                                                {cert.status === 'ACTIVE' ? 'ใช้งาน' : cert.status}
                                            </Badge>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <div className="flex flex-wrap items-center">
                                                <p className="text-sm text-slate-500">ออกเมื่อ</p>
                                                <p className="text-sm">{formatDate(cert.issueDate)}</p>
                                            </div>
                                            <div className="flex flex-wrap items-center">
                                                <p className="text-sm text-slate-500">หมดอายุ</p>
                                                <p className="text-sm">{formatDate(cert.expiryDate)}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <Alert color="gray" >
                                ยังไม่มีใบรับรองสำหรับแปลงนี้
                            </Alert>
                        )}
                    </TabsContent>

                    {/* Cycles Tab */}
                    <TabsContent value="cycles">
                        {farm.plantingCycles && farm.plantingCycles.length > 0 ? (
                            <div className="grid grid-cols-2 gap-4">
                                {farm.plantingCycles.map(cycle => (
                                    <Link className="block rounded-lg bg-card p-5 shadow-sm"
                                        key={cycle.id}
                                        href={`/health/planting/${cycle.id}`}
                                        style={{ textDecoration: 'none', color: 'inherit' }}
                                    >
                                        <div className="mb-3 flex flex-wrap items-center">
                                            <p className="font-medium">{cycle.cycleName}</p>
                                            <Badge >
                                                {CYCLE_STATUS_META[cycle.status]?.label || 'ไม่ทราบสถานะ'}
                                            </Badge>
                                        </div>
                                        <p className="text-sm text-slate-500">
                                            เริ่ม: {formatDate(cycle.startDate)}
                                        </p>
                                    </Link>
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col py-6">
                                <Alert color="gray" >
                                    ยังไม่มีรอบการปลูกสำหรับแปลงนี้
                                </Alert>
                                <Button
                                    href="/health/planting/new"
                                    color="green"
                                    variant="secondary"
                                >
                                    เริ่มรอบปลูกใหม่
                                </Button>
                            </div>
                        )}
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
}
