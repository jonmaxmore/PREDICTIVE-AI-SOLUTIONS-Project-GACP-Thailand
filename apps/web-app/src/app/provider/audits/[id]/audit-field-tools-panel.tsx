import { notifications } from '@/lib/notifications';
import { providerApiPaths } from "@/lib/services/provider-api";
import { GPSCheckIn, AuditCamera } from './audit-field-tools';
import { uploadAuditPhoto } from '@/lib/services/audit-photo-upload';
import { providerRequest } from './provider-audit-job-sheet-config';

interface AuditFieldToolsPanelProps {
    applicationId: string;
    applicationNumber: string;
    locationLat?: number;
    locationLng?: number;
}

export function AuditFieldToolsPanel({
    applicationId,
    applicationNumber,
    locationLat,
    locationLng
}: AuditFieldToolsPanelProps) {
    return (
        <div className="flex flex-col gap-4">
            <GPSCheckIn
                targetLat={locationLat}
                targetLng={locationLng}
                radiusMeters={500}
                onCheckIn={async (result) => {
                    try {
                        await providerRequest(providerApiPaths.auditorSessionCheckIn(applicationId), {
                            method: 'POST',
                            body: JSON.stringify({
                                latitude: result.position.latitude,
                                longitude: result.position.longitude,
                                accuracy: result.position.accuracy,
                                withinRadius: result.withinRadius,
                                distanceMeters: result.distanceMeters,
                            }),
                        });
                        notifications.show({
                            color: result.withinRadius ? 'teal' : 'orange',
                            title: result.withinRadius ? 'Check-in สำเร็จ (บันทึกแล้ว)' : 'นอกรัศมี',
                            message: result.withinRadius
                                ? `ตำแหน่ง GPS ยืนยันแล้ว (${result.distanceMeters}m จากแปลง)`
                                : `ห่างจากแปลง ${result.distanceMeters}m (อนุญาต 500m)`,
                        });
                    } catch {
                        notifications.show({ color: 'red', title: 'ไม่สามารถบันทึก GPS ได้', message: 'กรุณาลองอีกครั้ง' });
                    }
                }}
            />
            <AuditCamera
                applicationId={applicationNumber}
                onCapture={async (photo) => {
                    try {
                        // The image goes first. This used to POST the photo's
                        // coordinates, timestamp and byte sizes to the session
                        // endpoint and never the picture, then say it had been
                        // saved — so the evidence behind a certification
                        // decision was discarded while the auditor was told it
                        // was kept, and a farm visit cannot be repeated.
                        const upload = await uploadAuditPhoto({
                            auditId: applicationId,
                            blob: photo.blob,
                            latitude: photo.metadata.latitude,
                            longitude: photo.metadata.longitude,
                            capturedAt: photo.metadata.capturedAt,
                        });

                        if (!upload.photoId) {
                            notifications.show({
                                color: 'red',
                                title: 'ไม่สามารถบันทึกรูปได้',
                                message: upload.error || 'กรุณาถ่ายใหม่อีกครั้ง',
                            });
                            return;
                        }

                        // Metadata only after the picture is safely stored, and
                        // carrying the id so the two records can be joined.
                        await providerRequest(providerApiPaths.auditorSessionEvidence(applicationId), {
                            method: 'POST',
                            body: JSON.stringify({
                                photos: [{
                                    id: photo.id,
                                    photoId: upload.photoId,
                                    fileHash: upload.fileHash,
                                    latitude: photo.metadata.latitude,
                                    longitude: photo.metadata.longitude,
                                    accuracy: photo.metadata.accuracy,
                                    capturedAt: photo.metadata.capturedAt,
                                    originalSize: photo.originalSize,
                                    watermarkedSize: photo.watermarkedSize,
                                }],
                            }),
                        });
                        notifications.show({
                            color: 'teal',
                            title: 'ถ่ายรูป + บันทึกแล้ว',
                            message: `ขนาด ${Math.round(photo.watermarkedSize / 1024)} KB พร้อมลายน้ำ GPS+เวลา`,
                        });
                    } catch {
                        notifications.show({ color: 'red', title: 'ไม่สามารถบันทึกรูปได้', message: 'กรุณาลองอีกครั้ง' });
                    }
                }}
            />
        </div>
    );
}
