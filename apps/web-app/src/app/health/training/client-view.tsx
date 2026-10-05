'use client';
import { Container, SimpleGrid } from '@/components/ui/layout-utils';
import { NumberInput } from '@/components/ui/form-controls';
import { ThemeIcon, ActionIcon } from '@/components/ui/icon-buttons';
import { Modal } from '@/components/ui/overlays';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { Select } from '@/components/ui/select';
import { Input as TextInput } from '@/components/ui/primitives/input';
import { Alert } from '@/components/ui/alert';
import { Spinner as Loader } from '@/components/ui/spinner';
import { Table } from '@/components/ui/primitives/table';
import { Checkbox } from '@/components/ui/checkbox';
import { useState, useEffect } from 'react';
import { DateInput } from '@/components/ui/date-input';
import {
    IconPlus,
    IconSchool,
    IconCertificate,
    IconUsers,
    IconClock,
    IconEdit,
    IconTrash,
    IconAlertCircle,
    IconCheck
} from '@tabler/icons-react';
import { TRAINING_TYPES, createDefaultTrainingFormData, type Farm, type TrainingRecord, type TrainingSummary } from './training-page-config';
import { apiClient } from '@/lib/api/api-client';
export default function TrainingPage() {
    const [records, setRecords] = useState<TrainingRecord[]>([]);
    const [recordsError, setRecordsError] = useState<string | null>(null);
    const [farms, setFarms] = useState<Farm[]>([]);
    const [selectedFarm, setSelectedFarm] = useState<string | null>(null);
    const [summary, setSummary] = useState<TrainingSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [modalOpen, setModalOpen] = useState(false);
    const [editingRecord, setEditingRecord] = useState<TrainingRecord | null>(null);
    const [formData, setFormData] = useState(createDefaultTrainingFormData);
    useEffect(() => {
        fetchFarms();
    }, []);
    useEffect(() => {
        if (selectedFarm) {
            fetchRecords(selectedFarm);
            fetchSummary(selectedFarm);
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
            console.error('[Training] Error fetching farms:', error);
        } finally {
            setLoading(false);
        }
    };
    const fetchRecords = async (farmId: string) => {
        try {
            const result = await apiClient.get<TrainingRecord[]>(`/training-records/farm/${farmId}`);
            if (result.success) {
                // apiClient unwraps one envelope level; `result.data` IS the array
                // (training-record-controller.js:96).
                setRecords(result.data || []);
                setRecordsError(null);
            } else {
                setRecordsError('ไม่สามารถโหลดบันทึกการอบรมได้ กรุณาลองใหม่อีกครั้ง');
            }
        } catch (error: unknown) {
            console.error('[Training] Error fetching records:', error);
            // A console line is not a message to the user. Without this the page
            // renders its empty state and tells someone their records do not exist
            // because a fetch failed (evidence/apple-qa-audit-2026-09-07).
            setRecordsError('ไม่สามารถโหลดบันทึกการอบรมได้ กรุณาลองใหม่อีกครั้ง');
        }
    };
    const fetchSummary = async (farmId: string) => {
        try {
            const result = await apiClient.get<TrainingSummary>(`/training-records/farm/${farmId}/summary`);
            if (result.success) {
                // apiClient unwraps one envelope level; `result.data` IS the summary
                // (training-record-controller.js:187).
                setSummary(result.data ?? null);
            }
        } catch (error: unknown) {
            console.error('[Training] Error fetching summary:', error);
        }
    };
    const handleSubmit = async () => {
        if (!selectedFarm) return;
        try {
            const url = editingRecord
                ? `/training-records/${editingRecord.id}`
                : '/training-records';
            const body = editingRecord
                ? formData
                : { ...formData, farmId: selectedFarm };
            const result = editingRecord
                ? await apiClient.put(url, body)
                : await apiClient.post(url, body);
            if (result.success) {
                setModalOpen(false);
                resetForm();
                fetchRecords(selectedFarm);
                fetchSummary(selectedFarm);
            }
        } catch (error: unknown) {
            console.error('[Training] Error saving record:', error);
        }
    };
    const handleDelete = async (id: string) => {
        if (!confirm('ยืนยันการลบบันทึกนี้?')) return;
        try {
            const result = await apiClient.delete(`/training-records/${id}`);
            if (result.success && selectedFarm) {
                fetchRecords(selectedFarm);
                fetchSummary(selectedFarm);
            }
        } catch (error: unknown) {
            console.error('[Training] Error deleting record:', error);
        }
    };
    const resetForm = () => {
        setEditingRecord(null);
        setFormData(createDefaultTrainingFormData());
    };
    const openEditModal = (record: TrainingRecord) => {
        setEditingRecord(record);
        setFormData({
            personName: record.personName,
            personRole: record.personRole || '',
            trainingTopic: record.trainingTopic,
            trainingType: record.trainingType,
            trainingDate: new Date(record.trainingDate),
            trainingHours: record.trainingHours || 0,
            trainingLocation: record.trainingLocation || '',
            trainedBy: record.trainedBy || '',
            organizerName: record.organizerName || '',
            hasCertificate: record.hasCertificate,
            certificateNo: record.certificateNo || '',
            expiryDate: record.expiryDate ? new Date(record.expiryDate) : null,
            passed: record.passed,
            notes: ''
        });
        setModalOpen(true);
    };
    const getTypeInfo = (type: string) => {
        return TRAINING_TYPES.find(t => t.value === type) || TRAINING_TYPES[6] || { value: 'OTHER', label: 'อื่น ๆ', color: 'gray' };
    };
    if (loading) {
        return (
            <div className="flex items-center justify-center">
                <Loader color="green" />
            </div>
        );
    }
    return (
        <Container size="full">
            <div className="flex flex-col gap-5">
                {/* Header */}
                <div className="flex flex-wrap items-center">
                    <div>
                        <h2 className="text-xl font-semibold text-foreground">บันทึกการอบรม</h2>
                        <p className="text-sm text-muted-foreground">
                            การฝึกอบรมบุคลากรตามมาตรฐาน GACP หมวด 6
                        </p>
                    </div>
                    <Button
                        leftSection={<IconPlus size={16} />}
                        color="green"
                        onClick={() => {
                            resetForm();
                            setModalOpen(true);
                        }}
                        disabled={!selectedFarm}
                    >
                        เพิ่มบันทึก
                    </Button>
                </div>
                {/* Farm Selector */}
                <div className="rounded-lg bg-card p-4 shadow-sm">
                    <Select
                        label="เลือกฟาร์ม"
                        placeholder="เลือกฟาร์ม"
                        data={farms.map(f => ({
                            value: f.id,
                            label: f.farmName
                        }))}
                        value={selectedFarm}
                        onChange={setSelectedFarm}
                    />
                </div>
                {/* Summary Cards */}
                {summary && (
                    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
                        <div className="rounded-lg bg-card shadow-sm">
                            <div className="flex flex-wrap items-center">
                                <ThemeIcon color="blue" size="xl">
                                    <IconUsers size={24} />
                                </ThemeIcon>
                                <div>
                                    <p className="text-xs text-muted-foreground">บุคลากร</p>
                                    <p className="text-xl font-bold">{summary.totalPersonnel}</p>
                                </div>
                            </div>
                        </div>
                        <div className="rounded-lg bg-card shadow-sm">
                            <div className="flex flex-wrap items-center">
                                <ThemeIcon color="green" size="xl">
                                    <IconSchool size={24} />
                                </ThemeIcon>
                                <div>
                                    <p className="text-xs text-muted-foreground">การอบรม</p>
                                    <p className="text-xl font-bold">{summary.totalRecords}</p>
                                </div>
                            </div>
                        </div>
                        <div className="rounded-lg bg-card shadow-sm">
                            <div className="flex flex-wrap items-center">
                                <ThemeIcon color="orange" size="xl">
                                    <IconClock size={24} />
                                </ThemeIcon>
                                <div>
                                    <p className="text-xs text-muted-foreground">ชั่วโมงรวม</p>
                                    <p className="text-xl font-bold">{summary.totalHours}</p>
                                </div>
                            </div>
                        </div>
                        <div className="rounded-lg bg-card shadow-sm">
                            <div className="flex flex-wrap items-center">
                                <ThemeIcon color="teal" size="xl">
                                    <IconCertificate size={24} />
                                </ThemeIcon>
                                <div>
                                    <p className="text-xs text-muted-foreground">ใบรับรอง GACP</p>
                                    <p className="text-xl font-bold">{summary.byType?.GACP_BASIC || 0}</p>
                                </div>
                            </div>
                        </div>
                    </SimpleGrid>
                )}
                {/* Expiring Soon Alert */}
                {summary?.expiringSoon && summary.expiringSoon.length > 0 && (
                    <Alert icon={<IconAlertCircle size={16} />} color="yellow" title="ใบรับรองใกล้หมดอายุ">
                        {summary.expiringSoon.map((item, i) => (
                            <p className="text-sm" key={i}>
                                {item.personName} - {item.topic} (หมดอายุ: {new Date(item.expiryDate).toLocaleDateString('th-TH')})
                            </p>
                        ))}
                    </Alert>
                )}
                {/* Training Type Summary */}
                <div className="rounded-lg bg-card p-4 shadow-sm">
                    <p className="mb-4 font-semibold">สรุปตามประเภทการอบรม</p>
                    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
                        {TRAINING_TYPES.slice(0, 6).map(type => (
                            <Badge
                                key={type.value}
                                color={type.color}
                                size="lg"
                                className="p-3"
                            >
                                {type.label}: {summary?.byType?.[type.value] || 0}
                            </Badge>
                        ))}
                    </SimpleGrid>
                </div>
                {/* Records Table */}
                <div className="rounded-lg bg-card shadow-sm">
                    {/* Wide content scrolls inside its own box, never the page. Measured:
                        a 7-column table made document scrollWidth 444 against a 390px
                        viewport on /health/training, so the whole page slid sideways.
                        Table.ScrollContainer already existed and was simply not used
                        here (evidence/apple-qa-audit-2026-09-07). */}
                    <Table.ScrollContainer>
                        <Table>
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>ชื่อ-นามสกุล</Table.Th>
                                    <Table.Th>หัวข้อ</Table.Th>
                                    <Table.Th>ประเภท</Table.Th>
                                    <Table.Th>วันที่</Table.Th>
                                    <Table.Th>ชม.</Table.Th>
                                    <Table.Th>สถานะ</Table.Th>
                                    <Table.Th></Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {records.map(record => {
                                    const typeInfo = getTypeInfo(record.trainingType);
                                    return (
                                        <Table.Tr key={record.id}>
                                            <Table.Td>
                                                <p className="text-sm font-medium">{record.personName}</p>
                                                <p className="text-xs text-muted-foreground">{record.personRole}</p>
                                            </Table.Td>
                                            <Table.Td>{record.trainingTopic}</Table.Td>
                                            <Table.Td>
                                                <Badge color={typeInfo.color} size="sm">
                                                    {typeInfo.label}
                                                </Badge>
                                            </Table.Td>
                                            <Table.Td>
                                                {new Date(record.trainingDate).toLocaleDateString('th-TH')}
                                            </Table.Td>
                                            <Table.Td>{record.trainingHours || '-'}</Table.Td>
                                            <Table.Td>
                                                {record.passed ? (
                                                    <Badge color="green" leftSection={<IconCheck size={10} />}>
                                                        ผ่าน
                                                    </Badge>
                                                ) : (
                                                    <Badge color="red">ไม่ผ่าน</Badge>
                                                )}
                                                {record.hasCertificate && (
                                                    <Badge color="blue" size="xs">
                                                        มีใบรับรอง
                                                    </Badge>
                                                )}
                                            </Table.Td>
                                            <Table.Td>
                                                <div className="flex flex-wrap items-center">
                                                    <ActionIcon

                                                        color="blue"
                                                        aria-label="แก้ไขบันทึกการอบรม"
                                                        onClick={() => openEditModal(record)}
                                                    >
                                                        <IconEdit size={16} />
                                                    </ActionIcon>
                                                    <ActionIcon

                                                        color="red"
                                                        aria-label="ลบบันทึกการอบรม"
                                                        onClick={() => handleDelete(record.id)}
                                                    >
                                                        <IconTrash size={16} />
                                                    </ActionIcon>
                                                </div>
                                            </Table.Td>
                                        </Table.Tr>
                                    );
                                })}
                            </Table.Tbody>
                        </Table>
                    </Table.ScrollContainer>
                    {records.length === 0 && (
                        <div className="flex items-center justify-center p-6">
                            <p className="text-muted-foreground">{recordsError ?? 'ยังไม่มีบันทึกการอบรม'}</p>
                        </div>
                    )}
                </div>
            </div>
            {/* Add/Edit Modal */}
            <Modal
                opened={modalOpen}
                onClose={() => setModalOpen(false)}
                title={editingRecord ? 'แก้ไขบันทึก' : 'เพิ่มบันทึกการอบรม'}
                size="lg"
            >
                <div className="flex flex-col gap-4">
                    <SimpleGrid cols={2}>
                        <TextInput
                            label="ชื่อ-นามสกุล"
                            placeholder="ชื่อผู้เข้าอบรม"
                            value={formData.personName}
                            onChange={(e) => setFormData(prev => ({ ...prev, personName: e.currentTarget.value }))}
                            required
                        />
                        <TextInput
                            label="ตำแหน่ง/หน้าที่"
                            placeholder="เช่น เกษตรกร, ผู้จัดการฟาร์ม"
                            value={formData.personRole}
                            onChange={(e) => setFormData(prev => ({ ...prev, personRole: e.currentTarget.value }))}
                        />
                    </SimpleGrid>
                    <TextInput
                        label="หัวข้อการอบรม"
                        placeholder="ชื่อหลักสูตรหรือหัวข้อ"
                        value={formData.trainingTopic}
                        onChange={(e) => setFormData(prev => ({ ...prev, trainingTopic: e.currentTarget.value }))}
                        required
                    />
                    <SimpleGrid cols={2}>
                        <Select
                            label="ประเภทการอบรม"
                            data={TRAINING_TYPES}
                            value={formData.trainingType}
                            onChange={(v) => setFormData(prev => ({ ...prev, trainingType: v || 'GACP_BASIC' }))}
                        />
                        <DateInput
                            label="วันที่อบรม"
                            value={formData.trainingDate}
                            onChange={(v: Date | null) => setFormData(prev => ({ ...prev, trainingDate: v || new Date() }))}
                        />
                    </SimpleGrid>
                    <SimpleGrid cols={3}>
                        <NumberInput
                            label="จำนวนชั่วโมง"
                            value={formData.trainingHours}
                            onChange={(v) => setFormData(prev => ({ ...prev, trainingHours: Number(v) || 0 }))}
                        />
                        <TextInput
                            label="สถานที่อบรม"
                            value={formData.trainingLocation}
                            onChange={(e) => setFormData(prev => ({ ...prev, trainingLocation: e.currentTarget.value }))}
                        />
                        <TextInput
                            label="วิทยากร"
                            value={formData.trainedBy}
                            onChange={(e) => setFormData(prev => ({ ...prev, trainedBy: e.currentTarget.value }))}
                        />
                    </SimpleGrid>
                    <TextInput
                        label="หน่วยงานที่จัด"
                        placeholder="เช่น GACP Thai, มหาวิทยาลัย"
                        value={formData.organizerName}
                        onChange={(e) => setFormData(prev => ({ ...prev, organizerName: e.currentTarget.value }))}
                    />
                    <Checkbox
                        label="มีใบรับรอง/ใบประกาศนียบัตร"
                        checked={formData.hasCertificate}
                        onCheckedChange={(checked) => setFormData(prev => ({ ...prev, hasCertificate: checked }))}
                    />
                    {formData.hasCertificate && (
                        <SimpleGrid cols={2}>
                            <TextInput
                                label="เลขที่ใบรับรอง"
                                value={formData.certificateNo}
                                onChange={(e) => setFormData(prev => ({ ...prev, certificateNo: e.currentTarget.value }))}
                            />
                            <DateInput
                                label="วันหมดอายุ"
                                value={formData.expiryDate}
                                onChange={(v: Date | null) => setFormData(prev => ({ ...prev, expiryDate: v }))}
                            />
                        </SimpleGrid>
                    )}
                    <Checkbox
                        label="ผ่านการอบรม"
                        checked={formData.passed}
                        onCheckedChange={(checked) => setFormData(prev => ({ ...prev, passed: checked }))}
                    />
                    <div className="mt-4 flex flex-wrap items-center">
                        <Button onClick={() => setModalOpen(false)}>
                            ยกเลิก
                        </Button>
                        <Button color="green" onClick={handleSubmit}>
                            {editingRecord ? 'บันทึกการแก้ไข' : 'เพิ่มบันทึก'}
                        </Button>
                    </div>
                </div>
            </Modal>
        </Container>
    );
}
