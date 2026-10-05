'use client';


import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api';
import { Icons } from '@/components/ui/icons';
import { PageContainer } from '@/components/layout/page-system';
import { Button } from '@/components/ui/primitives/button';
import { Input } from '@/components/ui/primitives/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert } from '@/components/ui/alert';
import { Select } from '@/components/ui/select';
import {
    NO_PERMISSION_TOOLTIP_TH,
    useEntityPermissions,
} from '@/lib/services/use-entity-permissions';
import { buildFarmCreatePayload } from './farm-create-payload';
import { computeCanCreateFarm } from './farm-create-gate';
export default function NewEstablishmentPage() {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    // Farm-worker Wave C chunk 3 — creating a farm INTO a workspace
    // requires the FARM_CREATE effective permission (personal/solo context
    // → always true; fetch errors fail OPEN; BE re-checks with 403).
    const { has: hasWorkspacePermission, reportPermissionDenial } = useEntityPermissions();
    // F5 — extracted, behavior-tested derivation (polarity-proof).
    const canCreateFarm = computeCanCreateFarm(hasWorkspacePermission);

    const [form, setForm] = useState({
        name: '',
        address: '',
        province: '',
        district: '',
        subDistrict: '',
        type: 'INDOOR', // INDOOR, OUTDOOR, GREENHOUSE
        areaSize: '', // rai
        licenseNumber: ''
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        // Wave C chunk 3 — guard the submit path too (a disabled button is
        // bypassable via Enter-submit); the BE would 403
        // ENTITY_PERMISSION_DENIED regardless — this is the friendly path.
        if (!canCreateFarm) {
            setError(`${NO_PERMISSION_TOOLTIP_TH} (FARM_CREATE)`);
            return;
        }
        setSubmitting(true);
        setError('');

        try {
            // Wave A chunk 1: the real backend endpoint is POST /farms
            // (routes/api/cultivation/farms.js) — `/establishments` has no mount.
            // Wave A fix M4: apiClient NEVER throws on an API failure — it
            // resolves { success:false, error } (api-client.ts) — so navigation
            // must be gated on res.success or every failure silently "succeeds".
            const res = await apiClient.post<unknown>('/farms', buildFarmCreatePayload(form));

            if (!res.success) {
                // F1(b) — a live 403 ENTITY_PERMISSION_DENIED means the FE
                // gate was open on a STALE snapshot: evict so the next
                // mount refetches (non-denials no-op inside).
                reportPermissionDenial(res);
                setError(res.error || res.message || 'ไม่สามารถบันทึกข้อมูลสถานที่ปลูกได้ กรุณาลองใหม่อีกครั้ง');
                return;
            }

            router.push('/health/establishments');
        } catch (err: unknown) {
            console.error(err);
            setError('ไม่สามารถบันทึกข้อมูลสถานที่ปลูกได้ กรุณาลองใหม่อีกครั้ง');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <PageContainer>
            <div className="form-panel flex flex-col gap-5">
                    <div className="flex flex-wrap items-center">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                            <Icons.Home size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-foreground">ลงทะเบียนสถานที่เพาะปลูก</h2>
                            <p className="text-sm text-muted-foreground">เพิ่มข้อมูลสถานที่ปลูกใหม่เพื่อเริ่มต้นการขอรับรอง</p>
                        </div>
                    </div>

                    {error && (
                        <Alert color="red" title="ข้อผิดพลาด" icon={<Icons.AlertCircle size={16} />}>
                            {error}
                        </Alert>
                    )}

                    <form onSubmit={handleSubmit}>
                        <div className="flex flex-col gap-4">
                            <Input
                                label="ชื่อสถานที่ / ชื่อแปลง (Farm Name)"
                                placeholder="เช่น สวนสมุนไพรมีสุข แปลง A"
                                required
                                value={form.name}
                                onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
                            />

                            <Select
                                label="ประเภทโรงเรือน (Facility Type)"
                                placeholder="เลือกประเภท"
                                data={[
                                    { value: 'INDOOR', label: 'ระบบปิด (Indoor)' },
                                    { value: 'OUTDOOR', label: 'กลางแจ้ง (Outdoor)' },
                                    { value: 'GREENHOUSE', label: 'โรงเรือน (Greenhouse)' }
                                ]}
                                value={form.type}
                                onChange={(val) => setForm({ ...form, type: val || 'INDOOR' })}
                            />

                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <Input
                                    label="พื้นที่ (ตร.ม.)"
                                    placeholder="เช่น 2.5"
                                    required
                                    value={form.areaSize}
                                    onChange={(e) => setForm({ ...form, areaSize: e.currentTarget.value })}
                                />
                                <Input
                                    label="เลขที่ใบอนุญาต (ถ้ามี)"
                                    placeholder="เลขที่ใบอนุญาต"
                                    value={form.licenseNumber}
                                    onChange={(e) => setForm({ ...form, licenseNumber: e.currentTarget.value })}
                                />
                            </div>

                            <Textarea
                                label="ที่อยู่สถานที่ปลูก"
                                placeholder="ที่อยู่เลขที่..."
                                required

                                value={form.address}
                                onChange={(e) => setForm({ ...form, address: e.currentTarget.value })}
                            />

                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                                <Input
                                    label="จังหวัด"
                                    placeholder="เช่น เชียงใหม่"
                                    required
                                    value={form.province}
                                    onChange={(e) => setForm({ ...form, province: e.currentTarget.value })}
                                />
                                <Input
                                    label="อำเภอ/เขต"
                                    placeholder="เช่น แม่ริม"
                                    required
                                    value={form.district}
                                    onChange={(e) => setForm({ ...form, district: e.currentTarget.value })}
                                />
                                <Input
                                    label="ตำบล/แขวง"
                                    placeholder="เช่น ริมใต้"
                                    required
                                    value={form.subDistrict}
                                    onChange={(e) => setForm({ ...form, subDistrict: e.currentTarget.value })}
                                />
                            </div>

                            <div className="mt-6 flex flex-wrap items-center">
                                <Button variant="default" onClick={() => router.back()} size="md">
                                    ยกเลิก
                                </Button>
                                <Button
                                    type="submit"
                                    color="blue" // Use blue for establishments/infrastructure to differentiate from planting
                                    loading={submitting}
                                    disabled={!canCreateFarm}
                                    title={!canCreateFarm ? NO_PERMISSION_TOOLTIP_TH : undefined}
                                    size="md"
                                >
                                    บันทึกข้อมูล
                                </Button>
                            </div>
                        </div>
                    </form>
            </div>
        </PageContainer>
    );
}
