import { useState } from 'react';
import imageCompression from 'browser-image-compression';
import { notifications } from '@/lib/notifications';
import { IconAlertCircle, IconCheck } from '@tabler/icons-react';
import type { AuditEvidenceFile } from './provider-audit-job-sheet-config';

export function useEvidenceUpload() {
    const [evidenceFiles, setEvidenceFiles] = useState<AuditEvidenceFile[]>([]);
    const [isCompressing, setIsCompressing] = useState(false);

    const handleEvidenceUpload = async (files: File[]) => {
        if (!files || files.length === 0) return;
        setIsCompressing(true);

        const options = {
            maxSizeMB: 2,
            maxWidthOrHeight: 1920,
            useWebWorker: true,
        };

        try {
            const imageFiles = files.filter(f => f.type.startsWith('image/'));
            const skippedCount = files.length - imageFiles.length;

            if (imageFiles.length === 0) {
                notifications.show({
                    color: "yellow",
                    title: "ยังไม่ได้เลือกรูปภาพ",
                    message: "กรุณาเลือกไฟล์รูปภาพเท่านั้น",
                    icon: <IconAlertCircle size={16} aria-hidden="true" />,
                });
                return;
            }

            const compressedResults = await Promise.all(
                imageFiles.map(async (file) => {
                    const compressedFile = await imageCompression(file, options);
                    return {
                        id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${file.name}`,
                        file: compressedFile,
                        originalSize: file.size,
                        compressedSize: compressedFile.size,
                    };
                })
            );

            setEvidenceFiles(prev => [...prev, ...compressedResults]);
            notifications.show({
                color: "teal",
                title: "บีบอัดรูปภาพแล้ว",
                message: skippedCount > 0
                    ? `บีบอัดรูปภาพ ${compressedResults.length} รูป (ข้ามไฟล์ที่ไม่ใช่รูปภาพ ${skippedCount} ไฟล์)`
                    : `บีบอัดรูปภาพ ${compressedResults.length} รูปสำหรับใช้เป็นหลักฐานเรียบร้อยแล้ว`,
                icon: <IconCheck size={16} aria-hidden="true" />,
            });
        } catch (error: unknown) {
            console.error('Error compressing images', error);
            notifications.show({
                color: "red",
                title: "บีบอัดรูปภาพไม่สำเร็จ",
                message: "ไม่สามารถบีบอัดรูปภาพได้ กรุณาลองใหม่อีกครั้ง",
                icon: <IconAlertCircle size={16} aria-hidden="true" />,
            });
        } finally {
            setIsCompressing(false);
        }
    };

    const removeEvidence = (id: string) => {
        setEvidenceFiles(prev => prev.filter(e => e.id !== id));
    };

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return {
        evidenceFiles,
        setEvidenceFiles,
        isCompressing,
        handleEvidenceUpload,
        removeEvidence,
        formatBytes
    };
}
