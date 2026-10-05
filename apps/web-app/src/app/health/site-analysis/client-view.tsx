'use client';


import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/primitives/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog';
import { Spinner } from '@/components/ui/spinner';
import { SummaryHeader } from '@/components/feature';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/primitives/tabs';
import { DateInput } from '@/components/ui/date-input';
import {
    ANALYSIS_TYPES,
    RISK_LEVELS,
    createDefaultSiteAnalysisFormData,
    type Farm,
    type SiteAnalysis,
} from './site-analysis-page-config';
import {
    IconDroplet,
    IconPlant2,
    IconAlertTriangle,
    IconFileAnalytics,
    IconTrash
} from '@tabler/icons-react';
import { apiClient } from '@/lib/api/api-client';

export default function SiteAnalysisPage() {
    const [analyses, setAnalyses] = useState<SiteAnalysis[]>([]);
    const [farms, setFarms] = useState<Farm[]>([]);
    const [analysesError, setAnalysesError] = useState<string | null>(null);
    const [selectedFarm, setSelectedFarm] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingAnalysis, setEditingAnalysis] = useState<SiteAnalysis | null>(null);

    const [formData, setFormData] = useState(createDefaultSiteAnalysisFormData);

    useEffect(() => {
        fetchFarms();
    }, []);

    useEffect(() => {
        if (selectedFarm) {
            fetchAnalyses(selectedFarm);
        }
    }, [selectedFarm]);

    const fetchFarms = async () => {
        try {
            const result = await apiClient.get<Farm[]>('/farms');
            if (result.success) {
                // apiClient unwraps one envelope level (api-client.ts:410);
                // backend returns single-level `{ success, count, data: [...] }`
                // (farms.js:30) — so `result.data` IS the array.
                const farmsData = result.data ?? [];
                setFarms(farmsData);
                const firstFarm = farmsData[0];
                if (firstFarm) {
                    setSelectedFarm(firstFarm.id);
                }
            }
        } catch (error: unknown) {
            console.error('[SiteAnalysis] Error fetching farms:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchAnalyses = async (farmId: string) => {
        try {
            const result = await apiClient.get<SiteAnalysis[]>(`/site-analyses/farm/${farmId}`);
            if (result.success) {
                // apiClient unwraps one envelope level; `result.data` IS the array
                // (site-analysis-controller.js:82).
                setAnalyses(result.data || []);
                setAnalysesError(null);
            } else {
                setAnalysesError('ไม่สามารถโหลดรายงานการวิเคราะห์ได้ กรุณาลองใหม่อีกครั้ง');
            }
        } catch (error: unknown) {
            console.error('[SiteAnalysis] Error fetching analyses:', error);
            // A console line is not a message to the user. Without this the page
            // renders its empty state and tells someone their reports do not exist
            // because a fetch failed (evidence/apple-qa-audit-2026-09-07).
            setAnalysesError('ไม่สามารถโหลดรายงานการวิเคราะห์ได้ กรุณาลองใหม่อีกครั้ง');
        }
    };

    const handleSubmit = async () => {
        if (!selectedFarm) return;

        try {
            const url = editingAnalysis
                ? `/site-analyses/${editingAnalysis.id}`
                : '/site-analyses';

            const body = editingAnalysis
                ? formData
                : { ...formData, farmId: selectedFarm };

            const result = editingAnalysis
                ? await apiClient.put(url, body)
                : await apiClient.post(url, body);

            if (result.success) {
                setModalOpen(false);
                resetForm();
                fetchAnalyses(selectedFarm);
            }
        } catch (error: unknown) {
            console.error('[SiteAnalysis] Error saving analysis:', error);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('ยืนยันการลบรายงานนี้?')) return;

        try {
            const result = await apiClient.delete(`/site-analyses/${id}`);

            if (result.success && selectedFarm) {
                fetchAnalyses(selectedFarm);
            }
        } catch (error: unknown) {
            console.error('[SiteAnalysis] Error deleting analysis:', error);
        }
    };

    const resetForm = () => {
        setEditingAnalysis(null);
        setFormData(createDefaultSiteAnalysisFormData());
    };

    const getRiskColor = (level?: string) => {
        return RISK_LEVELS.find(r => r.value === level)?.color || 'gray';
    };

    const latestAnalysis = analyses[0];

    if (loading) {
        return (
            <div className="flex items-center justify-center">
                <Spinner color="green" />
            </div>
        );
    }

    return (
        // Wave E.2-B: SummaryHeader replaces inline header. Outer
        // max-w-sm was suspiciously narrow (384px) — likely a copy-paste
        // bug. Bumped to canonical max-w-4xl matching other detail pages
        // so the analysis form has reasonable room.
        <div className="w-full">
            <div className="flex flex-col gap-5">
                <SummaryHeader
                    eyebrow="ผู้ขอรับรอง · วิเคราะห์สถานที่"
                    title="วิเคราะห์สถานที่"
                    description="การประเมินสถานที่ตามมาตรฐาน GACP หมวด 1"
                    metrics={[
                        { label: 'รายงานทั้งหมด', value: analyses.length.toLocaleString('th-TH'), icon: '📋' },
                    ]}
                    actions={
                        <Button
                            color="green"
                            onClick={() => {
                                resetForm();
                                setModalOpen(true);
                            }}
                            disabled={!selectedFarm}
                        >
                            เพิ่มรายงาน
                        </Button>
                    }
                />

                {/* Farm Selector */}
                <div className="rounded-lg bg-card p-4 shadow-sm">
                    <Select
                        label="เลือกฟาร์ม"
                        placeholder="เลือกฟาร์มที่ต้องการวิเคราะห์"
                        data={farms.map(f => ({
                            value: f.id,
                            label: `${f.farmName} - ${f.province}`
                        }))}
                        value={selectedFarm}
                        onChange={setSelectedFarm}
                    />
                </div>

                {/* Summary Cards */}
                {latestAnalysis && (
                    <div className="grid grid-cols-2 gap-4">
                        <div className="rounded-lg bg-card shadow-sm">
                            <div className="flex flex-wrap items-center">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                    <IconPlant2 size={24} />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">ค่า pH ดิน</p>
                                    <p className="text-xl font-bold">
                                        {latestAnalysis.soilPH || '-'}
                                    </p>
                                    <Badge
                                        color={latestAnalysis.soilPH && latestAnalysis.soilPH >= 5.5 && latestAnalysis.soilPH <= 7.5 ? 'green' : 'red'}
                                        size="sm"
                                    >
                                        {latestAnalysis.soilPH && latestAnalysis.soilPH >= 5.5 && latestAnalysis.soilPH <= 7.5 ? 'ผ่าน' : 'ไม่ผ่าน'}
                                    </Badge>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-lg bg-card shadow-sm">
                            <div className="flex flex-wrap items-center">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                    <IconDroplet size={24} />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">ค่า pH น้ำ</p>
                                    <p className="text-xl font-bold">
                                        {latestAnalysis.waterPH || '-'}
                                    </p>
                                    <Badge
                                        color={latestAnalysis.waterPH && latestAnalysis.waterPH >= 6.5 && latestAnalysis.waterPH <= 8.5 ? 'green' : 'red'}
                                        size="sm"
                                    >
                                        {latestAnalysis.waterPH && latestAnalysis.waterPH >= 6.5 && latestAnalysis.waterPH <= 8.5 ? 'ผ่าน' : 'ไม่ผ่าน'}
                                    </Badge>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-lg bg-card shadow-sm">
                            <div className="flex flex-wrap items-center">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                    <IconAlertTriangle size={24} />
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">ระดับความเสี่ยง</p>
                                    <p className="text-xl font-bold">
                                        {RISK_LEVELS.find(r => r.value === latestAnalysis.riskLevel)?.label || '-'}
                                    </p>
                                    <Badge color={getRiskColor(latestAnalysis.riskLevel)}>
                                        {latestAnalysis.passedCriteria ? 'ผ่านเกณฑ์' : 'รอประเมิน'}
                                    </Badge>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Analysis List */}
                <div className="flex flex-col gap-3">
                    <p className="font-semibold">ประวัติการวิเคราะห์</p>
                    {analyses.map(analysis => (
                        <div className="rounded-lg bg-card p-4 shadow-sm" key={analysis.id}>
                            <div className="flex flex-wrap items-center">
                                <div className="flex flex-wrap items-center">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                                        <IconFileAnalytics size={20} />
                                    </div>
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Badge>{ANALYSIS_TYPES.find(t => t.value === analysis.analysisType)?.label}</Badge>
                                            <p className="text-sm text-muted-foreground">
                                                {new Date(analysis.analysisDate).toLocaleDateString('th-TH')}
                                            </p>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="text-sm">pH ดิน: {analysis.soilPH || '-'}</p>
                                            <p className="text-sm">pH น้ำ: {analysis.waterPH || '-'}</p>
                                            <Badge color={getRiskColor(analysis.riskLevel)}>
                                                ความเสี่ยง: {RISK_LEVELS.find(r => r.value === analysis.riskLevel)?.label || '-'}
                                            </Badge>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {analysis.passedCriteria ? (
                                        <Badge color="green">ผ่าน</Badge>
                                    ) : (
                                        <Badge color="gray">รอประเมิน</Badge>
                                    )}
                                    <Button
                                        variant="ghost"
                                        color="red"
                                        size="sm"
                                        onClick={() => handleDelete(analysis.id)}
                                    >
                                        <IconTrash size={16} />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ))}

                    {analyses.length === 0 && selectedFarm && (
                        <div className="rounded-lg bg-card p-6 text-center shadow-sm">
                            <p className="text-muted-foreground">{analysesError ?? 'ยังไม่มีรายงานการวิเคราะห์'}</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Add/Edit Modal */}
            <Dialog open={modalOpen} onOpenChange={(o) => !o && setModalOpen(false)}>
                <DialogContent className="max-w-4xl">
                    <DialogHeader><DialogTitle>เพิ่มรายงานวิเคราะห์สถานที่</DialogTitle></DialogHeader>

                    <Tabs defaultValue="land">
                        <TabsList>
                            <TabsTrigger value="land">ประวัติที่ดิน</TabsTrigger>
                            <TabsTrigger value="soil">ดิน</TabsTrigger>
                            <TabsTrigger value="water">น้ำ</TabsTrigger>
                            <TabsTrigger value="risk">ความเสี่ยง</TabsTrigger>
                        </TabsList>

                        <TabsContent value="land">
                            <div className="flex flex-col gap-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <Select
                                        label="ประเภทการประเมิน"
                                        data={ANALYSIS_TYPES}
                                        value={formData.analysisType}
                                        onChange={(v) => setFormData(prev => ({ ...prev, analysisType: v || 'INITIAL' }))}
                                    />
                                    <DateInput
                                        label="วันที่ประเมิน"
                                        value={formData.analysisDate}
                                        onChange={(v: Date | null) => setFormData(prev => ({ ...prev, analysisDate: v || new Date() }))}
                                    />
                                </div>
                                <Input
                                    label="การใช้ที่ดินก่อนหน้า"
                                    placeholder="เช่น นาข้าว, สวนผลไม้, ป่าธรรมชาติ"
                                    value={formData.previousLandUse}
                                    onChange={(e) => setFormData(prev => ({ ...prev, previousLandUse: e.currentTarget.value }))}
                                />
                                <Input type="number"
                                    label="ประวัติย้อนหลัง (ปี)"
                                    value={formData.yearsOfHistory}
                                    onChange={(v) => setFormData(prev => ({ ...prev, yearsOfHistory: Number(v) || 0 }))}
                                />
                                <Select
                                    label="เคยใช้สารเคมีอันตรายหรือไม่"
                                    data={[
                                        { value: 'false', label: 'ไม่เคย' },
                                        { value: 'true', label: 'เคย' },
                                    ]}
                                    value={formData.hasChemicalHistory ? 'true' : 'false'}
                                    onChange={(v) => setFormData(prev => ({ ...prev, hasChemicalHistory: v === 'true' }))}
                                />
                            </div>
                        </TabsContent>

                        <TabsContent value="soil">
                            <div className="flex flex-col gap-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <Input type="number"
                                        label="ค่า pH ดิน"
                                        description="ค่าที่เหมาะสม: 5.5 - 7.5"
                                        value={formData.soilPH}
                                        onChange={(v) => setFormData(prev => ({ ...prev, soilPH: Number(v) || 0 }))}

                                    />
                                    <Input type="number"
                                        label="อินทรียวัตถุ (%)"
                                        value={formData.soilOrganic}
                                        onChange={(v) => setFormData(prev => ({ ...prev, soilOrganic: Number(v) || 0 }))}

                                    />
                                </div>
                                <Input
                                    label="URL รายงานวิเคราะห์ดิน"
                                    placeholder="https://..."
                                    value={formData.soilReportUrl}
                                    onChange={(e) => setFormData(prev => ({ ...prev, soilReportUrl: e.currentTarget.value }))}
                                />
                            </div>
                        </TabsContent>

                        <TabsContent value="water">
                            <div className="flex flex-col gap-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <Input type="number"
                                        label="ค่า pH น้ำ"
                                        description="ค่าที่เหมาะสม: 6.5 - 8.5"
                                        value={formData.waterPH}
                                        onChange={(v) => setFormData(prev => ({ ...prev, waterPH: Number(v) || 0 }))}

                                    />
                                    <Input type="number"
                                        label="ค่าการนำไฟฟ้า (dS/m)"
                                        value={formData.waterEC}
                                        onChange={(v) => setFormData(prev => ({ ...prev, waterEC: Number(v) || 0 }))}

                                    />
                                </div>
                                <Input
                                    label="URL รายงานวิเคราะห์น้ำ"
                                    placeholder="https://..."
                                    value={formData.waterReportUrl}
                                    onChange={(e) => setFormData(prev => ({ ...prev, waterReportUrl: e.currentTarget.value }))}
                                />
                            </div>
                        </TabsContent>

                        <TabsContent value="risk">
                            <div className="flex flex-col gap-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <Input type="number"
                                        label="ระยะห่างจากแหล่งมลพิษ (เมตร)"
                                        description="ควรมากกว่า 500 เมตร"
                                        value={formData.bufferZoneMeters}
                                        onChange={(v) => setFormData(prev => ({ ...prev, bufferZoneMeters: Number(v) || 0 }))}
                                    />
                                    <Select
                                        label="ระดับความเสี่ยง"
                                        data={RISK_LEVELS}
                                        value={formData.riskLevel}
                                        onChange={(v) => setFormData(prev => ({ ...prev, riskLevel: v || 'LOW' }))}
                                    />
                                </div>
                                <Input
                                    label="แหล่งมลพิษใกล้เคียง"
                                    placeholder="เช่น โรงงาน, ถนนใหญ่"
                                    value={formData.nearbyPollution}
                                    onChange={(e) => setFormData(prev => ({ ...prev, nearbyPollution: e.currentTarget.value }))}
                                />
                                <Textarea
                                    label="หมายเหตุ"
                                    rows={3}
                                    value={formData.notes}
                                    onChange={(e) => setFormData(prev => ({ ...prev, notes: e.currentTarget.value }))}
                                />
                            </div>
                        </TabsContent>
                    </Tabs>

                    <div className="mt-6 flex flex-wrap items-center">
                        <Button variant="default" onClick={() => setModalOpen(false)}>
                            ยกเลิก
                        </Button>
                        <Button color="green" onClick={handleSubmit}>
                            บันทึก
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
