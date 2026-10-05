import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/primitives/dialog';
import { Input } from '@/components/ui/primitives/input';
import { Button } from '@/components/ui/primitives/button';
import { Alert } from '@/components/ui/alert';
import { Icons } from '@/components/ui/icons';
import { apiClient as api } from '@/lib/api/api-client';

interface ChangePasswordModalProps {
    opened: boolean;
    onClose: () => void;
}

export function ChangePasswordModal({ opened, onClose }: ChangePasswordModalProps) {
    const [oldPassword, setOldPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess(false);

        if (newPassword.length < 8) {
            setError('รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 8 ตัวอักษร');
            return;
        }

        if (newPassword !== confirmPassword) {
            setError('รหัสผ่านยืนยันไม่ตรงกัน');
            return;
        }

        setLoading(true);

        try {
            const result = await api.post<unknown>('/auth/health/change-password', {
                oldPassword,
                newPassword,
            });

            if (result.success) {
                setSuccess(true);
                setOldPassword('');
                setNewPassword('');
                setConfirmPassword('');
                setTimeout(() => {
                    onClose();
                    setSuccess(false);
                }, 1500);
            } else {
                setError(result.error || 'เกิดข้อผิดพลาดในการเปลี่ยนรหัสผ่าน');
            }
        } catch (_err) {
            setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
        } finally {
            setLoading(false);
        }
    };

    return (
<Dialog open={opened} onOpenChange={(o) => !o && onClose()}>
  <DialogContent className="max-w-lg">
    <DialogHeader><DialogTitle>เปลี่ยนรหัสผ่าน</DialogTitle></DialogHeader>
          
            <form onSubmit={handleSubmit}>
                <div className="flex flex-col">
                    {error && (
                        <Alert color="red" icon={<Icons.AlertCircle size={16} />}>
                            {error}
                        </Alert>
                    )}

                    {success && (
                        <Alert color="green" icon={<Icons.CheckCircle size={16} />}>
                            เปลี่ยนรหัสผ่านสำเร็จ
                        </Alert>
                    )}

                    <Input type="password"
                        label="รหัสผ่านเดิม"
                        placeholder="กรอกรหัสผ่านเดิม"
                        required
                        value={oldPassword}
                        onChange={(e) => setOldPassword(e.currentTarget.value)}
                    />

                    <Input type="password"
                        label="รหัสผ่านใหม่"
                        placeholder="กรอกรหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)"
                        required
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.currentTarget.value)}
                    />

                    <Input type="password"
                        label="ยืนยันรหัสผ่านใหม่"
                        placeholder="กรอกรหัสผ่านใหม่ซ้ำอีกครั้ง"
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.currentTarget.value)}
                    />

                    <Button type="submit" color="green" loading={loading}>
                        บันทึกรหัสผ่านใหม่
                    </Button>
                </div>
            </form>
          </DialogContent>
</Dialog>
    );
}
