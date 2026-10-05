"use client";

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import ProviderLayout from '../../components/provider-layout';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Input } from '@/components/ui/primitives/input';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives/tabs';
import { ConfirmDialog, SummaryHeader } from '@/components/feature';
import {
    AlertCircle,
    Check,
    Download,
    Pencil,
    Plus,
    RefreshCcw,
    Trash2,
    Upload,
    X,
} from 'lucide-react';
import { notifications } from '@/lib/notifications';
import { providerApiPaths } from '@/lib/services/provider-api';
import { apiClient } from '@/lib/api/api-client';

interface StageConfig {
    id: string;
    workflowStage: string;
    workType: string;
    candidateGroup: string;
    displayOrder: number;
    labelTH: string;
    labelEN: string;
    descriptionTH: string | null;
    isActive: boolean;
}

interface SlaPolicy {
    id: string;
    workType: string;
    targetHours: number;
    warningHours: number | null;
    escalationHours: number | null;
    labelTH: string;
    labelEN: string;
    isActive: boolean;
}

interface ConfigPayload {
    stageConfigs: StageConfig[];
    slaPolicies: SlaPolicy[];
    workflowStages: string[];
    candidateGroups: string[];
}

const EMPTY: ConfigPayload = {
    stageConfigs: [],
    slaPolicies: [],
    workflowStages: [],
    candidateGroups: [],
};

const apiPath = (full: string) => full.replace(/^\/api\//, '');

export default function WorkConfigClient() {
    const [config, setConfig] = useState<ConfigPayload>(EMPTY);
    const [isLoading, setIsLoading] = useState(true);
    const [editingStageId, setEditingStageId] = useState<string | null>(null);
    // Wave E.3-C follow-up: ConfirmDialog state for delete-stage.
    const [pendingDeleteStageId, setPendingDeleteStageId] = useState<string | null>(null);
    const [editingSlaWorkType, setEditingSlaWorkType] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);
    const [draft, setDraft] = useState<Partial<StageConfig & SlaPolicy>>({});
    const [showImport, setShowImport] = useState(false);
    const [importJson, setImportJson] = useState('');
    const [importing, setImporting] = useState(false);

    const fetchConfig = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await apiClient.get<ConfigPayload>(apiPath(providerApiPaths.workConfig));
            if (res.success && res.data) {
                setConfig(res.data);
            } else {
                notifications.show({
                    color: 'red',
                    title: 'โหลดไม่สำเร็จ',
                    message: res.error || 'ไม่สามารถโหลดค่าคอนฟิกได้',
                    icon: <AlertCircle size={16} />,
                });
            }
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => { fetchConfig(); }, [fetchConfig]);

    function startEditStage(s: StageConfig) {
        setEditingStageId(s.id);
        setDraft({ ...s });
    }
    function cancelEdit() {
        setEditingStageId(null);
        setEditingSlaWorkType(null);
        setShowCreate(false);
        setDraft({});
    }

    async function saveStage() {
        if (!editingStageId) return;
        try {
            const res = await apiClient.put<{ data: StageConfig }>(
                apiPath(providerApiPaths.workConfigStage(editingStageId)),
                draft,
            );
            if (!res.success) {
                notifications.show({ color: 'red', title: 'บันทึกล้มเหลว', message: res.error || '', icon: <AlertCircle size={16} /> });
                return;
            }
            notifications.show({ color: 'teal', title: 'บันทึกเรียบร้อย', message: '' });
            cancelEdit();
            await fetchConfig();
        } catch (e: unknown) {
            notifications.show({ color: 'red', title: 'บันทึกล้มเหลว', message: e instanceof Error ? e.message : 'unknown' });
        }
    }

    // Wave E.3-C follow-up: deleteStage now opens a state-driven dialog.
    function deleteStage(id: string) {
        setPendingDeleteStageId(id);
    }

    async function performDeleteStage(id: string) {
        try {
            const res = await apiClient.delete<{ success: boolean }>(apiPath(providerApiPaths.workConfigStage(id)));
            if (!res.success) {
                notifications.show({ color: 'red', title: 'ลบล้มเหลว', message: res.error || '', icon: <AlertCircle size={16} /> });
                return;
            }
            notifications.show({ color: 'teal', title: 'ลบเรียบร้อย', message: '' });
            await fetchConfig();
        } catch (e: unknown) {
            notifications.show({ color: 'red', title: 'ลบล้มเหลว', message: e instanceof Error ? e.message : 'unknown' });
        } finally {
            setPendingDeleteStageId(null);
        }
    }

    async function createStage() {
        try {
            const res = await apiClient.post<{ data: StageConfig }>(
                apiPath(providerApiPaths.workConfigStages),
                draft,
            );
            if (!res.success) {
                notifications.show({ color: 'red', title: 'สร้างล้มเหลว', message: res.error || '', icon: <AlertCircle size={16} /> });
                return;
            }
            notifications.show({ color: 'teal', title: 'สร้างเรียบร้อย', message: '' });
            cancelEdit();
            await fetchConfig();
        } catch (e: unknown) {
            notifications.show({ color: 'red', title: 'สร้างล้มเหลว', message: e instanceof Error ? e.message : 'unknown' });
        }
    }

    async function exportConfig() {
        try {
            const res = await apiClient.get<{ exportedAt: string; stageConfigs: StageConfig[]; slaPolicies: SlaPolicy[] }>(
                apiPath(providerApiPaths.workConfigExport),
            );
            if (!res.success || !res.data) {
                notifications.show({ color: 'red', title: 'ส่งออกไม่สำเร็จ', message: res.error || '' });
                return;
            }
            const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `work-config-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            notifications.show({ color: 'teal', title: 'ส่งออกเรียบร้อย', message: 'ดาวน์โหลดเรียบร้อย' });
        } catch (e: unknown) {
            notifications.show({
                color: 'red',
                title: 'ส่งออกไม่สำเร็จ',
                message: e instanceof Error ? e.message : 'unknown',
            });
        }
    }

    async function runImport() {
        let payload: unknown;
        try {
            payload = JSON.parse(importJson);
        } catch {
            notifications.show({ color: 'red', title: 'JSON ผิดรูปแบบ', message: 'ตรวจสอบรูปแบบ JSON' });
            return;
        }
        setImporting(true);
        try {
            const res = await apiClient.post<{ stagesUpserted: number; slaUpserted: number }>(
                apiPath(providerApiPaths.workConfigImport),
                payload as Record<string, unknown>,
            );
            if (!res.success) {
                notifications.show({ color: 'red', title: 'นำเข้าไม่สำเร็จ', message: res.error || '' });
                return;
            }
            notifications.show({
                color: 'teal',
                title: 'นำเข้าเรียบร้อย',
                message: `${res.data?.stagesUpserted ?? 0} stage configs + ${res.data?.slaUpserted ?? 0} SLA policies upserted`,
            });
            setShowImport(false);
            setImportJson('');
            await fetchConfig();
        } finally {
            setImporting(false);
        }
    }

    async function saveSla() {
        if (!editingSlaWorkType) return;
        try {
            const res = await apiClient.put<{ data: SlaPolicy }>(
                apiPath(providerApiPaths.workConfigSla(editingSlaWorkType)),
                draft,
            );
            if (!res.success) {
                notifications.show({ color: 'red', title: 'บันทึกล้มเหลว', message: res.error || '', icon: <AlertCircle size={16} /> });
                return;
            }
            notifications.show({ color: 'teal', title: 'บันทึกเรียบร้อย', message: '' });
            cancelEdit();
            await fetchConfig();
        } catch (e: unknown) {
            notifications.show({ color: 'red', title: 'บันทึกล้มเหลว', message: e instanceof Error ? e.message : 'unknown' });
        }
    }

    return (
        // Wave E.2-B: SummaryHeader replaces inline rounded-2xl card
        // header. Export / Import / Refresh actions move into the
        // canonical actions slot.
        <ProviderLayout>
            <div className="space-y-4 p-4 sm:p-6">
                <SummaryHeader
                    eyebrow="ผู้ให้บริการ · คิวงาน"
                    title="ตั้งค่าคิวงาน"
                    description="จัดการ Stage Activity Configs (กำหนดว่าแต่ละ stage เกิดงานอะไร) และ SLA Policies (กำหนดเวลาให้งานแต่ละประเภท). ทุกการเปลี่ยนแปลงถูกบันทึกใน Audit Log."
                    actions={
                        <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={exportConfig}>
                                <Download size={14} className="mr-1" aria-hidden="true" /> Export
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
                                <Upload size={14} className="mr-1" aria-hidden="true" /> Import
                            </Button>
                            <Button variant="outline" size="sm" onClick={fetchConfig} disabled={isLoading} aria-label="รีเฟรชค่าคอนฟิก">
                                <RefreshCcw size={14} className="mr-1" aria-hidden="true" /> รีเฟรช
                            </Button>
                        </div>
                    }
                />

                {showImport ? (
                    <div className="rounded-lg border border-border bg-card p-6">
                        <h2 id="work-config-import-heading" className="mb-2 text-sm font-medium text-foreground">
                            Import JSON (upsert mode — never deletes)
                        </h2>
                        <p id="work-config-import-desc" className="mb-3 text-xs text-muted-foreground">
                            วาง JSON ในรูปแบบเดียวกับที่ Export มา. ระบบจะ upsert ตามคู่ (workflowStage, workType) และ workType
                            สำหรับ SLA. แถวที่ไม่อยู่ใน JSON จะไม่ถูกลบ ใช้ปุ่มลบรายตัวสำหรับการลบ.
                        </p>
                        <label htmlFor="work-config-import-json" className="sr-only">ข้อมูล JSON สำหรับนำเข้า</label>
                        <textarea
                            id="work-config-import-json"
                            aria-describedby="work-config-import-desc"
                            value={importJson}
                            onChange={(e) => setImportJson(e.target.value)}
                            placeholder='{ "stageConfigs": [...], "slaPolicies": [...] }'
                            rows={10}
                            className="w-full rounded-md border bg-background p-2 font-mono text-xs focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        />
                        <div className="mt-3 flex flex-col justify-end gap-2 sm:flex-row">
                            <Button variant="ghost" size="sm" onClick={() => { setShowImport(false); setImportJson(''); }}>
                                ยกเลิก
                            </Button>
                            <Button size="sm" onClick={runImport} disabled={importing || !importJson.trim()}>
                                <Upload size={14} className="mr-1" aria-hidden="true" /> Import
                            </Button>
                        </div>
                    </div>
                ) : null}

                {isLoading ? (
                    <div className="flex items-center justify-center py-20"><Spinner /></div>
                ) : (
                    <Tabs defaultValue="stages">
                        <TabsList>
                            <TabsTrigger value="stages">
                                กิจกรรมขั้นตอน ({config.stageConfigs.length})
                            </TabsTrigger>
                            <TabsTrigger value="sla">
                                นโยบาย SLA ({config.slaPolicies.length})
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="stages">
                            <section className="overflow-hidden rounded-xl border bg-card">
                                <div className="flex items-center justify-between border-b p-3">
                                    <h2 className="text-sm font-medium text-foreground">
                                        ตั้งค่ากิจกรรมของแต่ละขั้นตอน
                                    </h2>
                                    {!showCreate ? (
                                        <Button size="sm" onClick={() => { setShowCreate(true); setDraft({ isActive: true, displayOrder: 0 }); }} aria-label="เพิ่ม stage activity config ใหม่">
                                            <Plus size={14} className="mr-1" aria-hidden="true" /> เพิ่ม
                                        </Button>
                                    ) : null}
                                </div>

                                {showCreate ? (
                                    <CreateStageRow
                                        draft={draft}
                                        setDraft={setDraft}
                                        workflowStages={config.workflowStages}
                                        candidateGroups={config.candidateGroups}
                                        onSave={createStage}
                                        onCancel={cancelEdit}
                                    />
                                ) : null}

                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-muted/40">
                                            <tr className="text-left text-xs text-muted-foreground">
                                                <th className="px-3 py-2">ขั้นตอน</th>
                                                <th className="px-3 py-2">ประเภทงาน</th>
                                                <th className="px-3 py-2">กลุ่มผู้รับผิดชอบ</th>
                                                <th className="px-3 py-2">ป้ายภาษาไทย</th>
                                                <th className="px-3 py-2">ลำดับ</th>
                                                <th className="px-3 py-2">สถานะ</th>
                                                <th className="px-3 py-2 text-right">การจัดการ</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {config.stageConfigs.map((s) => (
                                                editingStageId === s.id ? (
                                                    <EditStageRow
                                                        key={s.id}
                                                        draft={draft}
                                                        setDraft={setDraft}
                                                        candidateGroups={config.candidateGroups}
                                                        onSave={saveStage}
                                                        onCancel={cancelEdit}
                                                    />
                                                ) : (
                                                    <tr key={s.id} className="border-t">
                                                        <td className="px-3 py-2 font-mono text-xs">{s.workflowStage}</td>
                                                        <td className="px-3 py-2 font-mono text-xs">{s.workType}</td>
                                                        <td className="px-3 py-2">{s.candidateGroup}</td>
                                                        <td className="px-3 py-2">{s.labelTH}</td>
                                                        <td className="px-3 py-2">{s.displayOrder}</td>
                                                        <td className="px-3 py-2">
                                                            <Badge color={s.isActive ? 'green' : 'gray'}>
                                                                {s.isActive ? 'active' : 'inactive'}
                                                            </Badge>
                                                        </td>
                                                        <td className="px-3 py-2 text-right">
                                                            <div className="flex justify-end gap-1">
                                                                <Button size="sm" variant="ghost" onClick={() => startEditStage(s)} aria-label={`แก้ไขขั้นตอน ${s.workflowStage} / ${s.workType}`} className="min-h-[44px] min-w-[44px]">
                                                                    <Pencil size={14} aria-hidden="true" />
                                                                </Button>
                                                                <Button size="sm" variant="ghost" onClick={() => deleteStage(s.id)} aria-label={`ลบขั้นตอน ${s.workflowStage} / ${s.workType}`} className="min-h-[44px] min-w-[44px]">
                                                                    <Trash2 size={14} aria-hidden="true" />
                                                                </Button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )
                                            ))}
                                            {config.stageConfigs.length === 0 ? (
                                                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">ยังไม่มี config</td></tr>
                                            ) : null}
                                        </tbody>
                                    </table>
                                </div>
                            </section>
                        </TabsContent>

                        <TabsContent value="sla">
                            <section className="overflow-hidden rounded-xl border bg-card">
                                <div className="border-b p-3">
                                    <h2 className="text-sm font-medium text-foreground">
                                        นโยบาย SLA
                                    </h2>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Hours = ชั่วโมงนับจากตอนสร้าง activity. การแก้ไม่ส่งผลย้อนหลัง งานที่สร้างไปแล้วใช้ค่าตอนนั้น.
                                    </p>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead className="bg-muted/40">
                                            <tr className="text-left text-xs text-muted-foreground">
                                                <th className="px-3 py-2">ประเภทงาน</th>
                                                <th className="px-3 py-2">ป้ายกำกับ</th>
                                                <th className="px-3 py-2">เป้าหมาย (ชม.)</th>
                                                <th className="px-3 py-2">แจ้งเตือน (ชม.)</th>
                                                <th className="px-3 py-2">ยกระดับ (ชม.)</th>
                                                <th className="px-3 py-2">สถานะ</th>
                                                <th className="px-3 py-2 text-right">การจัดการ</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {config.slaPolicies.map((p) => (
                                                editingSlaWorkType === p.workType ? (
                                                    <EditSlaRow
                                                        key={p.workType}
                                                        draft={draft}
                                                        setDraft={setDraft}
                                                        onSave={saveSla}
                                                        onCancel={cancelEdit}
                                                    />
                                                ) : (
                                                    <tr key={p.workType} className="border-t">
                                                        <td className="px-3 py-2 font-mono text-xs">{p.workType}</td>
                                                        <td className="px-3 py-2">{p.labelTH}</td>
                                                        <td className="px-3 py-2">{p.targetHours}</td>
                                                        <td className="px-3 py-2">{p.warningHours ?? '-'}</td>
                                                        <td className="px-3 py-2">{p.escalationHours ?? '-'}</td>
                                                        <td className="px-3 py-2">
                                                            <Badge color={p.isActive ? 'green' : 'gray'}>
                                                                {p.isActive ? 'active' : 'inactive'}
                                                            </Badge>
                                                        </td>
                                                        <td className="px-3 py-2 text-right">
                                                            <Button size="sm" variant="ghost" onClick={() => { setEditingSlaWorkType(p.workType); setDraft({ ...p }); }} aria-label={`แก้ไข SLA ของ ${p.workType}`} className="min-h-[44px] min-w-[44px]">
                                                                <Pencil size={14} aria-hidden="true" />
                                                            </Button>
                                                        </td>
                                                    </tr>
                                                )
                                            ))}
                                            {config.slaPolicies.length === 0 ? (
                                                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">ยังไม่มี policy</td></tr>
                                            ) : null}
                                        </tbody>
                                    </table>
                                </div>
                            </section>
                        </TabsContent>
                    </Tabs>
                )}
            </div>

            {/* Wave E.3-C follow-up: replacement for window.confirm() on stage delete. */}
            <ConfirmDialog
                open={pendingDeleteStageId !== null}
                onOpenChange={(open) => { if (!open) setPendingDeleteStageId(null); }}
                onConfirm={() => { if (pendingDeleteStageId) performDeleteStage(pendingDeleteStageId); }}
                title="ลบ activity config?"
                description="การลบจะไม่ส่งผลกับงานที่สร้างไปแล้ว"
                confirmLabel="ลบ"
                variant="destructive"
            />
        </ProviderLayout>
    );
}

interface RowEditProps {
    draft: Partial<StageConfig & SlaPolicy>;
    setDraft: (d: Partial<StageConfig & SlaPolicy>) => void;
    onSave: () => void;
    onCancel: () => void;
}

function CreateStageRow({ draft, setDraft, workflowStages, candidateGroups, onSave, onCancel }: RowEditProps & {
    workflowStages: string[];
    candidateGroups: string[];
}) {
    return (
        <div className="grid grid-cols-1 gap-2 border-b bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-7">
            <select
                value={draft.workflowStage || ''}
                onChange={(e) => setDraft({ ...draft, workflowStage: e.target.value })}
                aria-label="ขั้นตอนงาน"
                className="rounded-md border bg-background px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
                <option value="">-- workflow stage --</option>
                {workflowStages.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <Input
                placeholder="WORK_TYPE"
                aria-label="ประเภทงาน"
                value={draft.workType || ''}
                onChange={(e) => setDraft({ ...draft, workType: e.target.value.toUpperCase() })}
            />
            <select
                value={draft.candidateGroup || ''}
                onChange={(e) => setDraft({ ...draft, candidateGroup: e.target.value })}
                aria-label="กลุ่มผู้รับผิดชอบ"
                className="rounded-md border bg-background px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
                <option value="">-- group --</option>
                {candidateGroups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <Input placeholder="ป้ายไทย" aria-label="ป้ายภาษาไทย" value={draft.labelTH || ''} onChange={(e) => setDraft({ ...draft, labelTH: e.target.value })} />
            <Input placeholder="ป้ายภาษาอังกฤษ" aria-label="ป้ายภาษาอังกฤษ" value={draft.labelEN || ''} onChange={(e) => setDraft({ ...draft, labelEN: e.target.value })} />
            <Input placeholder="ลำดับ" type="number" aria-label="ลำดับการแสดง" value={draft.displayOrder ?? 0} onChange={(e) => setDraft({ ...draft, displayOrder: Number(e.target.value) })} />
            <div className="flex justify-end gap-1">
                <Button size="sm" onClick={onSave} aria-label="บันทึกขั้นตอน" className="min-h-[44px] min-w-[44px]"><Check size={14} aria-hidden="true" /></Button>
                <Button size="sm" variant="ghost" onClick={onCancel} aria-label="ยกเลิก" className="min-h-[44px] min-w-[44px]"><X size={14} aria-hidden="true" /></Button>
            </div>
        </div>
    );
}

function EditStageRow({ draft, setDraft, candidateGroups, onSave, onCancel }: RowEditProps & {
    candidateGroups: string[];
}) {
    return (
        <tr className="border-t bg-muted/20">
            <td className="px-3 py-2 font-mono text-xs">{draft.workflowStage}</td>
            <td className="px-3 py-2 font-mono text-xs">{draft.workType}</td>
            <td className="px-3 py-2">
                <select
                    value={draft.candidateGroup || ''}
                    onChange={(e) => setDraft({ ...draft, candidateGroup: e.target.value })}
                    aria-label="กลุ่มผู้รับผิดชอบ"
                    className="w-full rounded-md border bg-background px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                    {candidateGroups.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
            </td>
            <td className="px-3 py-2"><Input aria-label="ป้ายภาษาไทย" value={draft.labelTH || ''} onChange={(e) => setDraft({ ...draft, labelTH: e.target.value })} /></td>
            <td className="px-3 py-2"><Input type="number" aria-label="ลำดับการแสดง" value={draft.displayOrder ?? 0} onChange={(e) => setDraft({ ...draft, displayOrder: Number(e.target.value) })} /></td>
            <td className="px-3 py-2">
                <label className="inline-flex items-center gap-1 text-xs">
                    <input
                        type="checkbox"
                        checked={!!draft.isActive}
                        onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                    />
                    active
                </label>
            </td>
            <td className="px-3 py-2 text-right">
                <div className="flex justify-end gap-1">
                    <Button size="sm" onClick={onSave} aria-label="บันทึกการแก้ไข" className="min-h-[44px] min-w-[44px]"><Check size={14} aria-hidden="true" /></Button>
                    <Button size="sm" variant="ghost" onClick={onCancel} aria-label="ยกเลิกการแก้ไข" className="min-h-[44px] min-w-[44px]"><X size={14} aria-hidden="true" /></Button>
                </div>
            </td>
        </tr>
    );
}

function EditSlaRow({ draft, setDraft, onSave, onCancel }: RowEditProps) {
    return (
        <tr className="border-t bg-muted/20">
            <td className="px-3 py-2 font-mono text-xs">{draft.workType}</td>
            <td className="px-3 py-2"><Input aria-label="ป้ายภาษาไทย" value={draft.labelTH || ''} onChange={(e) => setDraft({ ...draft, labelTH: e.target.value })} /></td>
            <td className="px-3 py-2"><Input type="number" aria-label="ชั่วโมงเป้าหมาย" value={draft.targetHours ?? 0} onChange={(e) => setDraft({ ...draft, targetHours: Number(e.target.value) })} /></td>
            <td className="px-3 py-2"><Input type="number" aria-label="ชั่วโมงแจ้งเตือน" value={draft.warningHours ?? ''} onChange={(e) => setDraft({ ...draft, warningHours: e.target.value === '' ? null : Number(e.target.value) })} /></td>
            <td className="px-3 py-2"><Input type="number" aria-label="ชั่วโมงยกระดับ" value={draft.escalationHours ?? ''} onChange={(e) => setDraft({ ...draft, escalationHours: e.target.value === '' ? null : Number(e.target.value) })} /></td>
            <td className="px-3 py-2">
                <label className="inline-flex items-center gap-1 text-xs">
                    <input
                        type="checkbox"
                        checked={!!draft.isActive}
                        onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
                    />
                    active
                </label>
            </td>
            <td className="px-3 py-2 text-right">
                <div className="flex justify-end gap-1">
                    <Button size="sm" onClick={onSave} aria-label="บันทึก SLA" className="min-h-[44px] min-w-[44px]"><Check size={14} aria-hidden="true" /></Button>
                    <Button size="sm" variant="ghost" onClick={onCancel} aria-label="ยกเลิกการแก้ไข" className="min-h-[44px] min-w-[44px]"><X size={14} aria-hidden="true" /></Button>
                </div>
            </td>
        </tr>
    );
}
