"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    Building2,
    Lock,
    MapPin,
    Plus,
    Info,
    ChevronRight
} from "lucide-react";

import { apiClient as api } from "@/lib/api/api-client";
import { AuthService } from "@/lib/services/auth-service";
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { Card, CardContent } from '@/components/ui/primitives/card';
import { Spinner } from '@/components/ui/spinner';
import { SummaryHeader } from '@/components/feature';
import { motion } from 'framer-motion';
import { AREA_UNIT_LABEL, formatAreaSqm, legacyAreaToSqm } from '@/lib/area';

interface Farm {
    id: string;
    farmName: string;
    farmType: string;
    province: string;
    district: string;
    totalArea: number;
    areaUnit: string;
    status: string;
    createdAt: string;
}

const STATUS_LABELS: Record<string, string> = {
    DRAFT: 'แบบร่าง',
    PENDING_VERIFICATION: 'รอตรวจสอบ',
    VERIFIED: 'ผ่านการรับรอง',
    REJECTED: 'ไม่ผ่าน',
};

export default function EstablishmentsPage() {
    const router = useRouter();
    const [mounted, setMounted] = useState(false);
    const [farms, setFarms] = useState<Farm[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCertified, setIsCertified] = useState(false);
    const [checkingAccess, setCheckingAccess] = useState(true);

    useEffect(() => {
        setMounted(true);
        const user = AuthService.getUser();
        if (!user) {
            router.push("/auth/health/login");
            return;
        }

        checkAccessAndLoad();
    }, [router]);

    const checkAccessAndLoad = async () => {
        try {
            // Access gate: only holders of a currently-active GACP certificate
            // may view the traceability / establishments section. Fail closed —
            // any error or absence of an active cert blocks access.
            const certResult = await api.get('/api/certificates/my');
            const certs = ((certResult.data as { data?: Array<{ status?: string }> })?.data
                || (certResult.data as Array<{ status?: string }>)
                || []) as Array<{ status?: string }>;
            const hasActiveCert = Array.isArray(certs) && certs.some(
                (cert) => String(cert?.status ?? '').toUpperCase() === 'ACTIVE'
            );
            setIsCertified(hasActiveCert);
            setCheckingAccess(false);

            if (!hasActiveCert) {
                return;
            }

            const farmResult = await api.get<Farm[]>('/api/farms/my');
            if (farmResult.success && farmResult.data) {
                setFarms(Array.isArray(farmResult.data) ? farmResult.data : []);
            }

        } catch (err: unknown) {
            console.error('Failed to load data:', err);
            setCheckingAccess(false);
        } finally {
            setLoading(false);
        }
    };

    if (!mounted || checkingAccess) return (
        <div className="flex h-[60vh] items-center justify-center">
            <Spinner className="h-8 w-8 text-primary" />
        </div>
    );

    if (!isCertified) {
        return (
            <div className="animate-fade-in-up mx-auto max-w-lg px-4 py-20 text-center">
                <div className="card-shadow rounded-[2.5rem] border border-border bg-card p-12">
                    <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-amber-50 text-amber-500">
                        <Lock className="h-10 w-10" />
                    </div>
                    <h2 className="text-2xl font-bold text-foreground">ยังไม่เปิดใช้งาน</h2>
                    <p className="mt-4 text-sm font-medium leading-relaxed text-muted-foreground">
                        ส่วนนี้เปิดให้เฉพาะผู้ที่ได้รับการรับรองมาตรฐาน GACP แล้วเท่านั้น
                        กรุณายื่นคำขอรับรองใหม่เพื่อเริ่มต้นเข้าสู่ระบบตรวจสอบย้อนกลับ
                    </p>
                    <div className="mt-10 flex flex-col gap-3">
                        <Button asChild size="lg" className="h-12 rounded-xl bg-primary font-bold shadow-lg shadow-primary/20 hover:bg-primary/90">
                            <Link href="/health/applications/new">ยื่นคำขอรับรองใหม่</Link>
                        </Button>
                        <Button asChild variant="ghost" className="h-12 rounded-xl font-bold text-muted-foreground hover:bg-muted">
                            {/* Task 7 (tile-home-nav rename sweep): was href="/health/dashboard"
                                label "กลับสู่แดชบอร์ด" — the retired landing route + old vocabulary.
                                /health/home is the current tile-home entry point (N1/N5). */}
                            <Link href="/health/home">กลับสู่หน้าหลัก</Link>
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        // Wave E.2-B: SummaryHeader replaces inline header. Total farm
        // count surfaces as a metric. animate-fade-in already provided
        // by DashboardLayout main element — outer wrapper just spaces.
        <div className="space-y-8">
            <SummaryHeader
                eyebrow="ผู้ขอรับรอง · สถานประกอบการ"
                title="สถานประกอบการ"
                description="ฟาร์มและแหล่งผลิตที่ได้รับการรับรองมาตรฐาน GACP"
                metrics={[
                    { label: 'ฟาร์มทั้งหมด', value: farms.length.toLocaleString('th-TH'), icon: '🏭' },
                ]}
                actions={
                    <Button asChild className="rounded-full bg-primary px-6 font-bold hover:bg-primary/90">
                        <Link href="/health/establishments/new">
                            <Plus className="mr-2 h-4 w-4" /> เพิ่มสถานประกอบการ
                        </Link>
                    </Button>
                }
            />

            {loading ? (
                <div className="flex h-[40vh] items-center justify-center">
                    <Spinner className="h-8 w-8 text-primary" />
                </div>
            ) : farms.length > 0 ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {farms.map((farm, idx) => (
                        <motion.div
                            key={farm.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.05 }}
                        >
                            <Link href={`/health/establishments/${farm.id}`} className="group block h-full">
                                <Card className="card-shadow h-full overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-primary/20 hover:shadow-lg">
                                    <CardContent className="p-6">
                                        <div className="mb-4 flex items-start justify-between">
                                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-white">
                                                <Building2 className="h-6 w-6" />
                                            </div>
                                            <Badge className="rounded-full border-none bg-leaf-soft px-3 py-0.5 text-[10px] font-bold text-leaf-onSoft">
                                                {STATUS_LABELS[farm.status] || farm.status}
                                            </Badge>
                                        </div>

                                        <h3 className="mb-1 text-lg font-bold text-foreground transition-colors group-hover:text-primary">
                                            {farm.farmName}
                                        </h3>

                                        <p className="mb-6 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                                            <MapPin className="h-3 w-3" />
                                            {farm.district}, {farm.province}
                                        </p>

                                        <div className="mt-auto grid grid-cols-2 gap-4 border-t border-border/50 pt-4">
                                            <div>
                                                <p className="mb-0.5 text-[10px] font-bold text-muted-foreground">ขนาดพื้นที่</p>
                                                <p className="text-sm font-bold text-foreground">{formatAreaSqm(legacyAreaToSqm(farm.totalArea, farm.areaUnit))} {AREA_UNIT_LABEL}</p>
                                            </div>
                                            <div>
                                                <p className="mb-0.5 text-[10px] font-bold text-muted-foreground">ประเภท</p>
                                                <p className="text-sm font-bold text-foreground">
                                                    {farm.farmType === 'CULTIVATION' ? 'เพาะปลูก' : farm.farmType === 'PROCESSING' ? 'แปรรูป' : 'แหล่งผลิต'}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="mt-6 flex items-center text-xs font-bold text-primary opacity-0 transition-opacity group-hover:opacity-100">
                                            ดูรายละเอียด <ChevronRight className="ml-1 h-3 w-3" />
                                        </div>
                                    </CardContent>
                                </Card>
                            </Link>
                        </motion.div>
                    ))}
                </div>
            ) : (
                <div className="rounded-[2rem] border-2 border-dashed border-border bg-muted/10 p-16 text-center">
                    <div className="card-shadow mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-card text-muted-foreground/30">
                        <Info className="h-8 w-8" />
                    </div>
                    <h2 className="text-lg font-bold text-foreground">ไม่พบข้อมูลสถานประกอบการ</h2>
                    <p className="mx-auto mt-2 max-w-xs text-sm font-medium text-muted-foreground">
                        เมื่อคุณได้รับการรับรองมาตรฐาน GACP ครั้งแรก ฟาร์มที่ผ่านการรับรองจะมาปรากฏที่นี่โดยอัตโนมัติ
                    </p>
                </div>
            )}
        </div>
    );
}
