"use client";

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import ProviderLayout from '@/app/provider/components/provider-layout';
import { useConfig } from '@/contexts/config-context';
import { apiClient } from '@/lib/api/api-client';
import { notifications } from '@/lib/notifications';
import { IconToggleLeft, IconToggleRight } from '@tabler/icons-react';
import { SummaryHeader } from '@/components/feature';

interface ConfigItem {
    id: string;
    key: string;
    value: unknown;
    description: string;
    group: string;
}

export default function SystemConfigPage() {
    const { refreshConfigs } = useConfig();
    const [configs, setConfigs] = useState<ConfigItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchConfigs();
    }, []);

    const fetchConfigs = async () => {
        try {
            const response = await apiClient.get<ConfigItem[]>('/system-config');
            if (response.success && Array.isArray(response.data)) {
                setConfigs(response.data);
            }
        } catch (error: unknown) {
            console.error('Failed to load admin configs:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleToggle = async (config: ConfigItem) => {
        const newValue = !config.value;
        try {
            // Optimistic update
            setConfigs(prev => prev.map(c => c.key === config.key ? { ...c, value: newValue } : c));

            const response = await apiClient.put(`/system-config/${config.key}`, { value: newValue });
            if (!response.success) {
                throw new Error(response.error || 'อัปเดตการตั้งค่าไม่สำเร็จ');
            }
            notifications.show({
                title: 'สำเร็จ',
                message: `อัปเดต ${config.key} แล้ว`,
                color: 'green'
            });
            refreshConfigs(); // Refresh global context
        } catch (_error) {
            notifications.show({
                title: 'ผิดพลาด',
                message: 'อัปเดตการตั้งค่าไม่สำเร็จ',
                color: 'red'
            });
            // Revert
            setConfigs(prev => prev.map(c => c.key === config.key ? { ...c, value: !newValue } : c));
        }
    };

    const groupedConfigs = configs.reduce((acc, curr) => {
        const bucket = (acc[curr.group] ??= []);
        bucket.push(curr);
        return acc;
    }, {} as Record<string, ConfigItem[]>);

    return (
        // Wave E.2-B: SummaryHeader replaces inline h2 + p inside the
        // wrapper card. Configs grid moves into a separate card below.
        <ProviderLayout title="ตั้งค่าระบบ">
            <div className="space-y-4 p-4 sm:p-6">
                <SummaryHeader
                    eyebrow="ผู้ให้บริการ · ตั้งค่าระบบ"
                    title="การตั้งค่าระบบและ Feature Flags"
                    description="จัดการการตั้งค่าส่วนกลางของระบบ การเปลี่ยนแปลงมีผลทันที"
                />
                <div className="rounded-lg border border-border bg-card p-4 sm:p-6">
                    {loading ? (
                        <div className="animate-pulse space-y-4">
                            {[1, 2, 3].map(i => <div key={i} className="h-12 rounded bg-muted"></div>)}
                        </div>
                    ) : (
                        <div className="space-y-8">
                            {Object.entries(groupedConfigs).map(([group, items]) => (
                                <div key={group}>
                                    <h3 className="mb-3 text-sm font-medium text-foreground">
                                        {group}
                                    </h3>
                                    <div className="space-y-4">
                                        {items.map(config => (
                                            <div key={config.key} className="flex items-center justify-between border-b border-border py-3 last:border-0">
                                                <div>
                                                    <div className="font-medium text-foreground">{config.key}</div>
                                                    <div className="text-sm text-muted-foreground">{config.description}</div>
                                                </div>
                                                <button
                                                    onClick={() => handleToggle(config)}
                                                    className={`rounded-md p-2 transition-colors ${config.value
                                                        ? 'text-leaf-onSoft hover:bg-leaf-soft'
                                                        : 'text-muted-foreground hover:bg-muted'
                                                        }`}
                                                >
                                                    {config.value ? (
                                                        <IconToggleRight size={36} stroke={1.5} />
                                                    ) : (
                                                        <IconToggleLeft size={36} stroke={1.5} />
                                                    )}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}

                            {configs.length === 0 && (
                                <div className="py-12 text-center text-muted-foreground">
                                    ไม่พบรายการตั้งค่า ฐานข้อมูลอาจกำลังเริ่มต้นทำงาน
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </ProviderLayout>
    );
}

