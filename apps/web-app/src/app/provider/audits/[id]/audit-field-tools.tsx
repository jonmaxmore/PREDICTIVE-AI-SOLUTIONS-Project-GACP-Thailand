'use client';

import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { Alert } from '@/components/ui/alert';
import {
    IconMapPin,
    IconCheck,
    IconAlertCircle,
    IconCurrentLocation,
    IconLoader,
} from '@tabler/icons-react';

// Types

export interface GeoPosition {
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: number;
}

export interface CheckInResult {
    position: GeoPosition;
    withinRadius: boolean;
    distanceMeters: number;
    checkedInAt: string;
}

interface GPSCheckInProps {
    /** Target farm location (if known) */
    targetLat?: number | undefined;
    targetLng?: number | undefined;
    /** Allowed radius in meters (default 500) */
    radiusMeters?: number;
    /** Callback when check-in succeeds */
    onCheckIn?: (result: CheckInResult) => void;
    /** Disable the component */
    disabled?: boolean;
}

// Haversine distance calculation

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth radius in meters
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Component

export function GPSCheckIn({
    targetLat,
    targetLng,
    radiusMeters = 500,
    onCheckIn,
    disabled = false,
}: GPSCheckInProps) {
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error' | 'out-of-range'>('idle');
    const [position, setPosition] = useState<GeoPosition | null>(null);
    const [distance, setDistance] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleCheckIn = useCallback(() => {
        if (!navigator.geolocation) {
            setError('เบราว์เซอร์ไม่รองรับ GPS / Geolocation API');
            setStatus('error');
            return;
        }

        setStatus('loading');
        setError(null);

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const geo: GeoPosition = {
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                    timestamp: pos.timestamp,
                };
                setPosition(geo);

                let withinRadius = true;
                let distanceMeters = 0;

                if (targetLat != null && targetLng != null) {
                    distanceMeters = haversineDistance(geo.latitude, geo.longitude, targetLat, targetLng);
                    withinRadius = distanceMeters <= radiusMeters;
                    setDistance(Math.round(distanceMeters));
                }

                const result: CheckInResult = {
                    position: geo,
                    withinRadius,
                    distanceMeters: Math.round(distanceMeters),
                    checkedInAt: new Date().toISOString(),
                };

                if (withinRadius) {
                    setStatus('success');
                    onCheckIn?.(result);
                } else {
                    setStatus('out-of-range');
                    setError(`ตำแหน่งห่างจากแปลง ${Math.round(distanceMeters)} เมตร (อนุญาต ${radiusMeters} เมตร)`);
                }
            },
            (err) => {
                setStatus('error');
                switch (err.code) {
                    case err.PERMISSION_DENIED:
                        setError('ผู้ใช้ปฏิเสธการเข้าถึงตำแหน่ง กรุณาเปิดสิทธิ์ GPS ในเบราว์เซอร์');
                        break;
                    case err.POSITION_UNAVAILABLE:
                        setError('ไม่สามารถระบุตำแหน่งได้ กรุณาเปิด GPS บนอุปกรณ์');
                        break;
                    case err.TIMEOUT:
                        setError('หมดเวลาค้นหาตำแหน่ง กรุณาลองใหม่');
                        break;
                    default:
                        setError('เกิดข้อผิดพลาดในการหาตำแหน่ง');
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 0,
            },
        );
    }, [targetLat, targetLng, radiusMeters, onCheckIn]);

    return (
        <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
            <div className="mb-3 flex items-center gap-2">
                <IconMapPin size={18} className="text-leaf-700" aria-hidden="true" />
                <p className="text-sm font-bold">GPS Check-in แปลงปลูก</p>
                {targetLat != null && targetLng != null && (
                    <Badge color="gray" size="sm">รัศมี {radiusMeters}m</Badge>
                )}
            </div>

            {status === 'idle' && (
                <Button
                    leftSection={<IconCurrentLocation size={16} aria-hidden="true" />}
                    onClick={handleCheckIn}
                    disabled={disabled}
                >
                    <span aria-hidden="true">📍</span> Check-in ณ ตำแหน่งปัจจุบัน
                </Button>
            )}

            {status === 'loading' && (
                <div className="flex items-center gap-2 text-sm text-slate-500" role="status" aria-live="polite">
                    <IconLoader size={16} className="animate-spin" aria-hidden="true" />
                    กำลังค้นหาตำแหน่ง GPS...
                </div>
            )}

            {status === 'success' && position && (
                // X2-FIX-B / H-8 — Alert colorToTone maps `teal → success`;
                // using semantic `color="green"` keeps the same visual
                // (success/emerald) while making the intent explicit.
                <Alert color="green" icon={<IconCheck size={16} aria-hidden="true" />} aria-live="polite">
                    <div className="flex flex-col gap-1">
                        <p className="text-sm font-semibold"><span aria-hidden="true">✅</span> Check-in สำเร็จ</p>
                        <p className="text-xs">
                            พิกัด: {position.latitude.toFixed(6)}, {position.longitude.toFixed(6)}
                            {' '}(±{Math.round(position.accuracy)}m)
                        </p>
                        {distance != null && (
                            <p className="text-xs">ระยะห่างจากแปลง: {distance} เมตร</p>
                        )}
                        <p className="text-xs text-slate-500">
                            {new Date(position.timestamp).toLocaleString('th-TH')}
                        </p>
                    </div>
                </Alert>
            )}

            {status === 'out-of-range' && (
                <div>
                    <Alert color="orange" icon={<IconAlertCircle size={16} aria-hidden="true" />} aria-live="polite">
                        <p className="text-sm">{error}</p>
                    </Alert>
                    <Button
                        color="orange"
                        variant="light"
                        size="sm"
                        className="mt-2"
                        onClick={handleCheckIn}
                    >
                        ลองใหม่อีกครั้ง
                    </Button>
                </div>
            )}

            {status === 'error' && (
                <div>
                    <Alert color="red" icon={<IconAlertCircle size={16} aria-hidden="true" />} aria-live="assertive">
                        <p className="text-sm">{error}</p>
                    </Alert>
                    <Button
                        color="red"
                        variant="light"
                        size="sm"
                        className="mt-2"
                        onClick={handleCheckIn}
                    >
                        ลองใหม่
                    </Button>
                </div>
            )}
        </div>
    );
}

// AUD-05: Camera-only Photo with Metadata Watermark

export interface WatermarkedPhoto {
    id: string;
    blob: Blob;
    dataUrl: string;
    metadata: {
        latitude: number | null;
        longitude: number | null;
        accuracy: number | null;
        capturedAt: string;
        applicationId?: string | undefined;
    };
    originalSize: number;
    watermarkedSize: number;
}

interface AuditCameraProps {
    applicationId?: string;
    onCapture?: (photo: WatermarkedPhoto) => void;
    disabled?: boolean;
}

/**
 * Stamps a watermark with GPS + timestamp onto a canvas image.
 */
function stampWatermark(
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D,
    metadata: { lat: number | null; lng: number | null; time: string; appId?: string | undefined },
) {
    const w = canvas.width;
    const h = canvas.height;
    const fontSize = Math.max(12, Math.floor(w / 40));

    // Semi-transparent black strip at bottom
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, h - fontSize * 3.5, w, fontSize * 3.5);

    // White text
    ctx.fillStyle = '#ffffff';
    ctx.font = `${fontSize}px monospace`;
    ctx.textBaseline = 'bottom';

    const lines: string[] = [];
    if (metadata.lat != null && metadata.lng != null) {
        lines.push(`📍 ${metadata.lat.toFixed(6)}, ${metadata.lng.toFixed(6)}`);
    }
    lines.push(`🕐 ${metadata.time}`);
    if (metadata.appId) {
        lines.push(`📋 ${metadata.appId}`);
    }

    lines.forEach((line, i) => {
        ctx.fillText(line, 10, h - fontSize * (lines.length - i - 0.3));
    });
}

export function AuditCamera({ applicationId, onCapture, disabled = false }: AuditCameraProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [lastPhoto, setLastPhoto] = useState<WatermarkedPhoto | null>(null);

    const handleCapture = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;

            setIsProcessing(true);

            try {
                // Get GPS position (best effort)
                let lat: number | null = null;
                let lng: number | null = null;
                let accuracy: number | null = null;

                try {
                    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition(resolve, reject, {
                            enableHighAccuracy: true,
                            timeout: 10000,
                        });
                    });
                    lat = pos.coords.latitude;
                    lng = pos.coords.longitude;
                    accuracy = pos.coords.accuracy;
                } catch {
                    // GPS unavailable — continue without it
                }

                const capturedAt = new Date().toISOString();

                // Read image to canvas
                const img = new Image();
                const objectUrl = URL.createObjectURL(file);
                await new Promise<void>((resolve, reject) => {
                    img.onload = () => resolve();
                    img.onerror = () => reject(new Error('Failed to load image'));
                    img.src = objectUrl;
                });

                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('Canvas context unavailable');

                // Draw original image
                ctx.drawImage(img, 0, 0);

                // Stamp watermark
                stampWatermark(canvas, ctx, {
                    lat,
                    lng,
                    time: new Date(capturedAt).toLocaleString('th-TH'),
                    appId: applicationId,
                });

                // Export
                const blob = await new Promise<Blob>((resolve, reject) => {
                    canvas.toBlob(
                        (b) => (b ? resolve(b) : reject(new Error('Blob creation failed'))),
                        'image/jpeg',
                        0.85,
                    );
                });

                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                URL.revokeObjectURL(objectUrl);

                const photo: WatermarkedPhoto = {
                    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-capture`,
                    blob,
                    dataUrl,
                    metadata: { latitude: lat, longitude: lng, accuracy, capturedAt, applicationId },
                    originalSize: file.size,
                    watermarkedSize: blob.size,
                };

                setLastPhoto(photo);
                onCapture?.(photo);
            } catch (err) {
                console.error('[AuditCamera] capture failed:', err);
            } finally {
                setIsProcessing(false);
                // Reset input so same file can be selected again
                if (fileInputRef.current) fileInputRef.current.value = '';
            }
        },
        [applicationId, onCapture],
    );

    return (
        <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
            <div className="mb-3 flex items-center gap-2">
                <span className="text-lg" aria-hidden="true">📸</span>
                <p className="text-sm font-bold">ถ่ายรูปหลักฐาน (พร้อมลายน้ำ)</p>
            </div>

            {/* Camera-only input (capture="environment" forces rear camera on mobile) */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleCapture}
                disabled={disabled || isProcessing}
                title="ถ่ายรูปหลักฐาน"
                aria-label="ถ่ายรูปหลักฐาน"
            />

            <Button
                variant="light"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || isProcessing}
                loading={isProcessing}
            >
                {isProcessing ?'กำลังประมวลผลภาพ...':'เปิดกล้องถ่ายรูป'}
            </Button>

            <p className="mt-1 text-xs text-slate-500">
                ระบบจะฝังลายน้ำ (พิกัด GPS / วันเวลา / เลขคำขอ) ลงในภาพอัตโนมัติ
            </p>

            {/* Preview last captured photo */}
            {lastPhoto && (
                <div className="mt-3">
                    <div className="overflow-hidden rounded-lg border border-leaf-300 dark:border-leaf-800">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={lastPhoto.dataUrl}
                            alt="ภาพหลักฐานพร้อมลายน้ำ"
                            className="w-full"
                        />
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                        <Badge tone="primary" size="sm"><span aria-hidden="true">✅</span> ถ่ายรูปแล้ว</Badge>
                        {lastPhoto.metadata.latitude != null && (
                            <Badge color="blue" size="sm">
                                <span aria-hidden="true">📍</span> {lastPhoto.metadata.latitude.toFixed(4)}, {lastPhoto.metadata.longitude?.toFixed(4)}
                            </Badge>
                        )}
                        <Badge color="gray" size="sm">
                            {Math.round(lastPhoto.watermarkedSize / 1024)} KB
                        </Badge>
                    </div>
                </div>
            )}
        </div>
    );
}
