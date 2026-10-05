'use client';


import { Table } from '@/components/ui/primitives/table';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { ActionIcon } from '@/components/ui/icon-buttons';
import { NumberInput } from '@/components/ui/form-controls';
import { SimpleGrid } from '@/components/ui/layout-utils';
import { Modal } from '@/components/ui/overlays';
import { Input as TextInput } from '@/components/ui/primitives/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert } from '@/components/ui/alert';
import { Spinner as Loader } from '@/components/ui/spinner';
import { apiClient } from '@/lib/api/api-client';

import { useEffect, useState } from 'react';

import {
    IconPlus,
    IconEdit,
    IconTrash,
    IconSettings,
    IconPlant,
    IconShieldCheck,
    IconClipboardList
} from '@tabler/icons-react';
import { IconBeaker } from '@/components/ui/icons';

interface Criterion {
    id: string;
    code: string;
    category: string;
    categoryTH: string | null;
    label: string;
    description: string | null;
    icon: string | null;
    sortOrder: number;
    isRequired: boolean;
    inputType: string;
    isActive: boolean;
    createdAt: string;
}

interface CriterionForm {
    code: string;
    category: string;
    categoryTH: string;
    label: string;
    description: string;
    icon: string;
    sortOrder: number;
    isRequired: boolean;
    inputType: string;
    isActive: boolean;
}

const defaultForm: CriterionForm = {
    code: '',
    category: '',
    categoryTH: '',
    label: '',
    description: '',
    icon: '📋',
    sortOrder: 0,
    isRequired: false,
    inputType: 'checkbox',
    isActive: true
};

const categoryOptions = [
    { value: 'TESTING', label: 'การทดสอบและตรวจสอบ', icon: <IconBeaker size={16} />, emoji: '🧪' },
    { value: 'PRODUCTION', label: 'ขั้นตอนการผลิต', icon: <IconSettings size={16} />, emoji: '⚙️' },
    { value: 'SEED_SOURCE', label: 'แหล่งที่มาเมล็ดพันธุ์', icon: <IconPlant size={16} />, emoji: '🌱' },
    { value: 'HYGIENE', label: 'สุขอนามัยและความปลอดภัย', icon: <IconShieldCheck size={16} />, emoji: '🛡️' },
    { value: 'OTHER', label: 'อื่น ๆ', icon: <IconClipboardList size={16} />, emoji: '📋' }
];

const inputTypeOptions = [
    { value: 'checkbox', label: 'ติ๊กถูก (Checkbox)' },
    { value: 'text', label: 'ข้อความ (Text)' },
    { value: 'number', label: 'ตัวเลข (Number)' },
    { value: 'file', label: 'ไฟล์แนบ (File)' }
];

export default function CriteriaManagementPage() {
    const [criteria, setCriteria] = useState<Criterion[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<CriterionForm>(defaultForm);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        fetchCriteria();
    }, []);

    async function fetchCriteria() {
        try {
            const result = await apiClient.get<Criterion[]>('/criteria/all');
            if (result.success && Array.isArray(result.data)) {
                setCriteria(result.data);
            }
        } catch (error: unknown) {
            console.error('Error:', error);
        } finally {
            setLoading(false);
        }
    }

    function handleEdit(criterion: Criterion) {
        setForm({
            code: criterion.code,
            category: criterion.category,
            categoryTH: criterion.categoryTH || '',
            label: criterion.label,
            description: criterion.description || '',
            icon: criterion.icon || '📋',
            sortOrder: criterion.sortOrder,
            isRequired: criterion.isRequired,
            inputType: criterion.inputType,
            isActive: criterion.isActive
        });
        setEditingId(criterion.id);
        setShowForm(true);
    }

    function handleNew() {
        setForm(defaultForm);
        setEditingId(null);
        setShowForm(true);
    }

    async function handleSubmit() {
        setSaving(true);
        setMessage(null);

        try {
            const result = editingId
                ? await apiClient.patch<Criterion>(`/criteria/${editingId}`, form)
                : await apiClient.post<Criterion>('/criteria', form);

            if (result.success) {
                setMessage({ type: 'success', text: editingId ? 'อัปเดตเรียบร้อย' : 'สร้างเรียบร้อย' });
                setShowForm(false);
                fetchCriteria();
            } else {
                setMessage({ type: 'error', text: result.error || 'เกิดข้อผิดพลาด' });
            }
        } catch (_error) {
            setMessage({ type: 'error', text: 'เกิดข้อผิดพลาดในการเชื่อมต่อ' });
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete(id: string) {
        if (!confirm('ต้องการลบเกณฑ์นี้?')) return;

        try {
            const result = await apiClient.delete<Criterion>(`/criteria/${id}`);
            if (result.success) {
                setMessage({ type: 'success', text: 'ลบเรียบร้อย' });
                fetchCriteria();
            } else {
                setMessage({ type: 'error', text: result.error || 'เกิดข้อผิดพลาด' });
            }
        } catch (_error) {
            setMessage({ type: 'error', text: 'เกิดข้อผิดพลาดในการเชื่อมต่อ' });
        }
    }

    async function handleToggleActive(id: string, isActive: boolean) {
        try {
            const result = await apiClient.patch<Criterion>(`/criteria/${id}`, { isActive: !isActive });
            if (result.success) {
                fetchCriteria();
            }
        } catch (error: unknown) {
            console.error('Error:', error);
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center p-6">
                <Loader color="primary" />
            </div>
        );
    }

    return (
        <div className="flex flex-col p-5">
            {/* Header */}
            <div className="flex flex-wrap items-center">
                <div>
                    <p className="text-xl font-bold">จัดการเกณฑ์เสริม</p>
                    <p className="text-sm text-muted-foreground">เพิ่ม ลบ แก้ไขเกณฑ์ที่แสดงในฟอร์มใบสมัคร</p>
                </div>
                <Button leftSection={<IconPlus size={18} />} onClick={handleNew}>
                    เพิ่มเกณฑ์ใหม่
                </Button>
            </div>

            {/* Message */}
            {message && (
                <Alert color={message.type === 'success' ? 'green' : 'red'} title={message.type === 'success' ? 'สำเร็จ' : 'ผิดพลาด'}>
                    {message.text}
                </Alert>
            )}

            {/* Table */}
            <div className="rounded-lg bg-card shadow-sm">
                <Table>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>เกณฑ์</Table.Th>
                            <Table.Th>หมวดหมู่</Table.Th>
                            <Table.Th>ประเภท</Table.Th>
                            <Table.Th>สถานะ</Table.Th>
                            <Table.Th>จัดการ</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {criteria.length === 0 ? (
                            <Table.Tr>
                                <Table.Td colSpan={5}>
                                    <p className="text-muted-foreground">ยังไม่มีเกณฑ์ในระบบ</p>
                                </Table.Td>
                            </Table.Tr>
                        ) : (
                            criteria.map((item) => (
                                <Table.Tr key={item.id}>
                                    <Table.Td>
                                        <p className="font-medium">{item.label}</p>
                                        <p className="text-xs text-muted-foreground">{item.code}</p>
                                    </Table.Td>
                                    <Table.Td>
                                        <Badge color="gray" size="sm">
                                            {item.categoryTH || item.category}
                                        </Badge>
                                    </Table.Td>
                                    <Table.Td>
                                        <p className="text-sm">{item.inputType}</p>
                                    </Table.Td>
                                    <Table.Td>
                                        <Badge

                                            color={item.isActive ? 'green' : 'gray'}
                                            style={{ cursor: 'pointer' }}
                                            onClick={() => handleToggleActive(item.id, item.isActive)}
                                        >
                                            {item.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}
                                        </Badge>
                                    </Table.Td>
                                    <Table.Td>
                                        <div className="flex flex-wrap items-center">
                                            <ActionIcon

                                                color="blue"
                                                aria-label={`แก้ไขเกณฑ์ ${item.label}`}
                                                onClick={() => handleEdit(item)}
                                            >
                                                <IconEdit size={16} />
                                            </ActionIcon>
                                            <ActionIcon

                                                color="red"
                                                aria-label={`ลบเกณฑ์ ${item.label}`}
                                                onClick={() => handleDelete(item.id)}
                                            >
                                                <IconTrash size={16} />
                                            </ActionIcon>
                                        </div>
                                    </Table.Td>
                                </Table.Tr>
                            ))
                        )}
                    </Table.Tbody>
                </Table>
            </div>

            {/* Stats */}
            <SimpleGrid cols={4} spacing="md">
                <div className="rounded-lg border border-mantine-blue-2 bg-card p-4 shadow-sm">
                    <p className="text-center text-xl font-bold text-blue-600">{criteria.length}</p>
                    <p className="text-center text-sm">เกณฑ์ทั้งหมด</p>
                </div>
                <div className="rounded-lg border border-mantine-green-2 bg-card p-4 shadow-sm">
                    <p className="text-center text-xl font-bold text-green-700">{criteria.filter(c => c.isActive).length}</p>
                    <p className="text-center text-sm">เปิดใช้งาน</p>
                </div>
                <div className="rounded-lg border border-mantine-gray-2 bg-card p-4 shadow-sm">
                    <p className="text-center text-xl font-bold text-muted-foreground">{criteria.filter(c => !c.isActive).length}</p>
                    <p className="text-center text-sm">ปิดใช้งาน</p>
                </div>
                <div className="rounded-lg border border-mantine-grape-2 bg-card p-4 shadow-sm">
                    <p className="text-center text-xl font-bold">{new Set(criteria.map(c => c.category)).size}</p>
                    <p className="text-center text-sm">หมวดหมู่</p>
                </div>
            </SimpleGrid>

            {/* Form Modal */}
            <Modal
                opened={showForm}
                onClose={() => setShowForm(false)}
                title={editingId ? 'แก้ไขเกณฑ์' : 'เพิ่มเกณฑ์ใหม่'}
                centered
            >
                <div className="flex flex-col">
                    <TextInput
                        label="รหัสเกณฑ์"
                        required
                        placeholder="เช่น CONTAMINANT_TEST"
                        value={form.code}
                        onChange={(e) => setForm({ ...form, code: e.currentTarget.value.toUpperCase() })}
                        disabled={!!editingId}
                    />

                    <Select
                        label="หมวดหมู่"
                        required
                        data={categoryOptions.map(opt => ({ value: opt.value, label: `${opt.emoji} ${opt.label}` }))}
                        value={form.category}
                        onChange={(val) => {
                            const opt = categoryOptions.find(o => o.value === val);
                            if (val && opt) {
                                setForm({
                                    ...form,
                                    category: val,
                                    categoryTH: opt.label,
                                    icon: opt.emoji
                                });
                            }
                        }}
                    />

                    <TextInput
                        label="ชื่อเกณฑ์"
                        required
                        placeholder="เช่น ผลตรวจสารปนเปื้อน"
                        value={form.label}
                        onChange={(e) => setForm({ ...form, label: e.currentTarget.value })}
                    />

                    <Textarea
                        label="คำอธิบาย"
                        placeholder="คำอธิบายเพิ่มเติม..."
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.currentTarget.value })}
                    />

                    <Select
                        label="ประเภท Input"
                        data={inputTypeOptions}
                        value={form.inputType}
                        onChange={(val) => val && setForm({ ...form, inputType: val })}
                    />

                    <NumberInput
                        label="ลำดับการแสดง"
                        value={form.sortOrder}
                        onChange={(val) => setForm({ ...form, sortOrder: Number(val) || 0 })}
                    />

                    <div className="flex flex-wrap items-center">
                        <Checkbox
                            label="บังคับกรอก"
                            checked={form.isRequired}
                            onCheckedChange={(checked) => setForm({ ...form, isRequired: checked })}
                        />
                        <Checkbox
                            label="เปิดใช้งาน"
                            checked={form.isActive}
                            onCheckedChange={(checked) => setForm({ ...form, isActive: checked })}
                        />
                    </div>

                    <div className="mt-4 flex flex-wrap items-center">
                        <Button onClick={() => setShowForm(false)}>ยกเลิก</Button>
                        <Button onClick={handleSubmit} loading={saving} color="blue">บันทึก</Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
