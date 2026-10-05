'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  ShieldCheck,
  ShieldOff,
  KeyRound,
  Copy,
  AlertTriangle,
  Loader2,
  CheckCircle2,
} from 'lucide-react';

import ProviderLayout from '../../components/provider-layout';
import ChangePasswordCard from './change-password-card';
import { apiClient } from '@/lib/api/api-client';
import { providerApiPaths } from '@/lib/services/provider-api';
import { notifications } from '@/lib/notifications';
import { Button } from '@/components/ui/primitives/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/primitives/card';
import { Input } from '@/components/ui/primitives/input';
import { Badge } from '@/components/ui/primitives/badge';

interface MfaStatusResponse {
  enabled: boolean;
}

interface MfaSetupResponse {
  secret: string;
  qrCodeUri: string;
  message?: string;
}

interface MfaVerifySetupResponse {
  message: string;
  backupCodes: string[];
  warning?: string;
}

type Phase =
  | 'loading'
  | 'disabled' // MFA not enabled — show "Enable MFA" CTA
  | 'qr-shown' // /setup returned, user is scanning + entering 6-digit code
  | 'backup-codes' // /verify-setup succeeded, one-time backup codes display
  | 'enabled' // MFA active — show disable form
  | 'error';

export default function ProviderSecurityPage() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Setup-flow state
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [setupQrDataUrl, setSetupQrDataUrl] = useState<string | null>(null);
  const [setupCodeInput, setSetupCodeInput] = useState('');
  const [setupSubmitting, setSetupSubmitting] = useState(false);

  // Backup codes (shown once after verify-setup)
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [acknowledgedBackup, setAcknowledgedBackup] = useState(false);

  // Re-enrol flow (2FA enabled → new device). The backend needs the CURRENT code
  // and keeps the old factor active until the new one is confirmed (round 4, 2026-09-26).
  const [reenrolCodeInput, setReenrolCodeInput] = useState('');
  const [reenrolSubmitting, setReenrolSubmitting] = useState(false);
  const [reenrolling, setReenrolling] = useState(false);

  // Disable-flow state
  const [disableCodeInput, setDisableCodeInput] = useState('');
  const [disableSubmitting, setDisableSubmitting] = useState(false);

  const loadStatus = useCallback(async () => {
    setPhase('loading');
    setErrorMsg(null);
    setReenrolling(false);
    try {
      const res = await apiClient.get<MfaStatusResponse>(providerApiPaths.mfaStatus);
      if (!res.success || !res.data) {
        throw new Error(res.error || 'Failed to read MFA status');
      }
      setPhase(res.data.enabled ? 'enabled' : 'disabled');
    } catch (err) {
      setPhase('error');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to read MFA status');
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Render the otpauth:// URI as a QR data-URL so the user can scan with
  // Google Authenticator / 1Password / Authy / Bitwarden. Done client-side
  // so the secret never round-trips an image proxy.
  const renderQr = useCallback(async (uri: string) => {
    try {
      const dataUrl = await QRCode.toDataURL(uri, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 256,
      });
      setSetupQrDataUrl(dataUrl);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'QR rendering failed');
    }
  }, []);

  const handleStartSetup = useCallback(async () => {
    setErrorMsg(null);
    setSetupCodeInput('');
    try {
      const res = await apiClient.post<MfaSetupResponse>(providerApiPaths.mfaSetup, {});
      if (!res.success || !res.data) {
        throw new Error(res.error || 'Setup failed');
      }
      setSetupSecret(res.data.secret);
      await renderQr(res.data.qrCodeUri);
      setPhase('qr-shown');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Setup failed');
      notifications.show({ title: 'เริ่มตั้งค่า MFA ไม่สำเร็จ', message: '', color: 'red' });
    }
  }, [renderQr]);

  const handleStartReenrol = useCallback(async () => {
    if (reenrolCodeInput.length !== 6) {
      return;
    }
    setErrorMsg(null);
    setReenrolSubmitting(true);
    try {
      const res = await apiClient.post<MfaSetupResponse>(providerApiPaths.mfaSetup, { code: reenrolCodeInput });
      if (!res.success || !res.data) {
        if (res.code === 'MFA_CODE_REQUIRED') {
          setErrorMsg('รหัสปัจจุบันไม่ถูกต้อง กรุณาใส่รหัส 6 หลักล่าสุดจากแอปที่ใช้อยู่');
        } else if (res.code === 'MFA_REENROL_UNAVAILABLE') {
          setErrorMsg('ย้ายไม่ได้ในขณะนี้ MFA เดิมยังใช้งานอยู่ กรุณาลองใหม่ภายหลัง');
        } else if (res.code === 'MFA_REENROL_SESSION_MISMATCH') {
          setErrorMsg('กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่ ก่อนย้าย MFA ไปเครื่องใหม่');
        } else {
          // 429 from the limiter, or anything else: not a statement about the code
          setErrorMsg(`ย้ายไม่สำเร็จ ${res.error || ''}`.trim());
        }
        return;
      }
      setReenrolCodeInput('');
      setSetupSecret(res.data.secret);
      setSetupCodeInput('');
      setReenrolling(true);
      await renderQr(res.data.qrCodeUri);
      setPhase('qr-shown');
    } catch {
      setErrorMsg('เชื่อมต่อระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setReenrolSubmitting(false);
    }
  }, [reenrolCodeInput, renderQr]);

  const handleVerifySetup = useCallback(async () => {
    if (setupCodeInput.length !== 6) {
      notifications.show({
        title: 'รหัส 6 หลักไม่ครบ',
        message: 'ใส่รหัสจากแอป Authenticator ให้ครบ 6 หลัก',
        color: 'red',
      });
      return;
    }
    setSetupSubmitting(true);
    try {
      const res = await apiClient.post<MfaVerifySetupResponse>(
        providerApiPaths.mfaVerifySetup,
        { code: setupCodeInput },
      );
      if (!res.success || !res.data) {
        // Round 5: 5 wrong codes delete the pending move, and only the session that
        // started it may finish it. Either way this QR is dead: go back to the start.
        if (reenrolling && (res.code === 'MFA_REENROL_RESTART' || res.code === 'MFA_REENROL_SESSION_MISMATCH')) {
          setSetupSecret(null);
          setSetupQrDataUrl(null);
          setSetupCodeInput('');
          await loadStatus();
          setErrorMsg('กรุณาเริ่มย้ายใหม่ด้วยรหัสจากแอปที่ใช้อยู่ MFA เดิมยังใช้งานอยู่');
          return;
        }
        throw new Error(res.error || 'Verification failed');
      }
      setBackupCodes(res.data.backupCodes || []);
      setSetupSecret(null);
      setSetupQrDataUrl(null);
      setSetupCodeInput('');
      setPhase('backup-codes');
      notifications.show({
        title: 'เปิดใช้งาน MFA สำเร็จ',
        message: 'กรุณาบันทึก backup codes ให้ปลอดภัย',
        color: 'green',
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'รหัสไม่ถูกต้อง');
      notifications.show({
        title: 'รหัส MFA ไม่ถูกต้อง',
        message: 'กรุณาลองใหม่อีกครั้ง',
        color: 'red',
      });
    } finally {
      setSetupSubmitting(false);
    }
  }, [setupCodeInput, reenrolling, loadStatus]);

  const handleDisable = useCallback(async () => {
    if (disableCodeInput.length !== 6) {
      notifications.show({
        title: 'รหัส 6 หลักไม่ครบ',
        message: 'ใส่รหัสปัจจุบันจากแอป Authenticator เพื่อยืนยันว่าเป็นคุณ',
        color: 'red',
      });
      return;
    }
    setDisableSubmitting(true);
    try {
      const res = await apiClient.delete(providerApiPaths.mfaDisable, {
        body: { code: disableCodeInput },
      });
      if (!res.success) {
        throw new Error(res.error || 'Disable failed');
      }
      setDisableCodeInput('');
      setPhase('disabled');
      notifications.show({
        title: 'ปิด MFA แล้ว',
        message: 'ระบบจะกลับไปใช้รหัสผ่านอย่างเดียวในการเข้าสู่ระบบ',
        color: 'orange',
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'รหัสไม่ถูกต้อง');
      notifications.show({
        title: 'ปิด MFA ไม่สำเร็จ',
        message: err instanceof Error ? err.message : 'รหัสไม่ถูกต้อง',
        color: 'red',
      });
    } finally {
      setDisableSubmitting(false);
    }
  }, [disableCodeInput]);

  const handleCopyBackupCodes = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(backupCodes.join('\n'));
      notifications.show({
        title: 'คัดลอกแล้ว',
        message: 'รหัสสำรอง 8 ชุดถูกคัดลอกไปยัง clipboard',
        color: 'green',
      });
    } catch {
      notifications.show({
        title: 'คัดลอกไม่สำเร็จ',
        message: 'กรุณา copy ด้วยตนเอง',
        color: 'red',
      });
    }
  }, [backupCodes]);

  return (
    <ProviderLayout title="ความปลอดภัยบัญชี" subtitle="Two-Factor Authentication (TOTP)">
      <div className="w-full space-y-6 p-4 sm:p-6">
        {/* Header card */}
        <Card className="rounded-lg border-border bg-card shadow-none">
          <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
              Multi-Factor Authentication
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-6">
            <p className="text-sm text-muted-foreground">
              เพิ่มชั้นการป้องกันบัญชีของคุณด้วย Authenticator app เช่น Google Authenticator,
              Authy, 1Password หรือ Bitwarden ทุกครั้งที่เข้าสู่ระบบ ระบบจะขอรหัส 6 หลักนอกเหนือจากรหัสผ่าน
            </p>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-muted-foreground">สถานะ:</span>
              {phase === 'loading' ? (
                <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> กำลังตรวจสอบ
                </span>
              ) : phase === 'enabled' ? (
                <Badge tone="success" className="rounded-md text-xs">
                  เปิดใช้งาน
                </Badge>
              ) : phase === 'error' ? (
                <Badge tone="danger" className="rounded-md text-xs">
                  อ่านสถานะไม่ได้
                </Badge>
              ) : (
                <Badge tone="warning" className="rounded-md text-xs">
                  ยังไม่เปิดใช้งาน
                </Badge>
              )}
            </div>
            {errorMsg && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* เปลี่ยนรหัสผ่านของตัวเอง (มติ operator 2026-09-26) — ทางเดียวที่รหัสผ่านเจ้าหน้าที่เปลี่ยนได้หลังสร้างบัญชี */}
        <ChangePasswordCard />

        {/* Phase: disabled — offer "Enable MFA" CTA */}
        {phase === 'disabled' && (
          <Card className="rounded-lg border-border bg-card shadow-none">
            <CardContent className="space-y-4 p-6">
              <div className="flex items-start gap-3">
                <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div>
                  <h3 className="font-medium text-foreground">เริ่มตั้งค่า MFA</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    ระบบจะสร้าง secret key ให้คุณสแกนด้วย Authenticator app เพียงครั้งเดียว จากนั้นทุกการเข้าสู่ระบบจะขอรหัส 6 หลัก
                  </p>
                </div>
              </div>
              <Button onClick={() => void handleStartSetup()}>
                <ShieldCheck className="mr-2 h-4 w-4" /> เปิดใช้งาน MFA
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Phase: qr-shown — display QR + ask for first 6-digit code */}
        {phase === 'qr-shown' && (
          <Card className="rounded-lg border-border bg-card shadow-none">
            <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
              <CardTitle className="text-sm font-medium text-foreground">
                ขั้นตอนที่ 1 · สแกน QR
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6 p-6">
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
                <div className="rounded-lg border border-border bg-white p-3">
                  {setupQrDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={setupQrDataUrl}
                      alt="MFA QR code"
                      className="h-64 w-64"
                    />
                  ) : (
                    <div className="flex h-64 w-64 items-center justify-center text-muted-foreground">
                      <Loader2 className="h-8 w-8 animate-spin" />
                    </div>
                  )}
                </div>
                <div className="flex-1 space-y-3 text-sm text-muted-foreground">
                  <p>
                    เปิดแอป Authenticator แล้วสแกน QR code ด้านซ้าย หรือใส่ secret
                    ด้านล่างด้วยตนเอง
                  </p>
                  {reenrolling && (
                    <p className="text-foreground">
                      แอปเดิมยังใช้ได้จนกว่าคุณจะยืนยันรหัสจากรายการใหม่ในขั้นตอนที่ 2
                    </p>
                  )}
                  {setupSecret && (
                    <div className="break-all rounded-lg bg-muted/40 p-3 font-mono text-xs text-foreground">
                      {setupSecret}
                    </div>
                  )}
                  <p className="text-xs">
                    ผู้ออก: <span className="font-mono">GACP-DTAM</span> · อัลกอริทึม: SHA-1 ·
                    จำนวนหลัก: 6 · รอบเวลา: 30 วินาที
                  </p>
                </div>
              </div>

              <div className="space-y-3 border-t border-border/40 pt-6">
                <div>
                  <h4 className="text-sm font-medium text-foreground">
                    ขั้นตอนที่ 2 · ยืนยันรหัส
                  </h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    ใส่รหัส 6 หลักจากแอปเพื่อยืนยันว่า setup สำเร็จ
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="max-w-xs flex-1">
                    <Input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={setupCodeInput}
                      onChange={(e) => setSetupCodeInput(e.target.value.replace(/\D/g, ''))}
                      placeholder="123456"
                      className="text-center font-mono text-lg tracking-widest"
                      disabled={setupSubmitting}
                    />
                  </div>
                  <Button
                    onClick={() => void handleVerifySetup()}
                    disabled={setupSubmitting || setupCodeInput.length !== 6}
                  >
                    {setupSubmitting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                    )}
                    ยืนยันและเปิดใช้งาน
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Phase: backup-codes — show one-time recovery codes */}
        {phase === 'backup-codes' && (
          <Card className="rounded-lg border-warning/40 bg-warning/10 shadow-none">
            <CardHeader className="border-b border-warning/30 px-6 py-4">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
                <AlertTriangle className="h-4 w-4" />
                บันทึก Backup Codes ก่อนปิดหน้านี้
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-6">
              <p className="text-sm text-foreground">
                หากคุณทำโทรศัพท์หาย คุณสามารถใช้รหัสด้านล่างนี้แทนรหัสจากแอป Authenticator
                ได้ครั้งเดียวต่อรหัส <strong>เก็บให้ปลอดภัย ระบบจะไม่แสดงอีกครั้ง</strong>
              </p>
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-card p-4 sm:grid-cols-4">
                {backupCodes.map((code, idx) => (
                  <div
                    key={`${code}-${idx}`}
                    className="rounded-md border border-border bg-muted/40 px-3 py-2 text-center font-mono text-sm"
                  >
                    {code}
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  variant="outline"
                  onClick={() => void handleCopyBackupCodes()}
                >
                  <Copy className="mr-2 h-4 w-4" /> คัดลอกทั้งหมด
                </Button>
                <Button
                  onClick={() => {
                    setAcknowledgedBackup(true);
                    setBackupCodes([]);
                    void loadStatus();
                  }}
                  disabled={acknowledgedBackup}
                >
                  ฉันบันทึกแล้ว ดำเนินการต่อ
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Phase: enabled — show disable form */}
        {/* Phase: enabled — move 2FA to a new device. Needs the current code first;
            the old factor keeps working until the new one is confirmed. */}
        {phase === 'enabled' && (
          <Card data-testid="mfa-reenrol" className="rounded-lg border-border bg-card shadow-none">
            <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
              <CardTitle className="text-sm font-medium text-foreground">
                ย้าย MFA ไปแอปหรือโทรศัพท์เครื่องใหม่
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-6 sm:pt-6">
              <p className="text-sm text-muted-foreground">
                ใส่รหัส 6 หลักปัจจุบันจากแอปที่ใช้อยู่เพื่อยืนยันว่าเป็นคุณ แล้วสแกน QR ใหม่ แอปเดิมยังใช้ได้จนกว่าจะยืนยันรหัสจากแอปใหม่
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="max-w-xs flex-1">
                  <Input
                    name="reenrolCurrentCode"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    autoComplete="one-time-code"
                    value={reenrolCodeInput}
                    onChange={(e) => setReenrolCodeInput(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    className="text-center font-mono text-lg tracking-widest"
                    disabled={reenrolSubmitting}
                  />
                </div>
                <Button
                  onClick={() => void handleStartReenrol()}
                  disabled={reenrolSubmitting || reenrolCodeInput.length !== 6}
                >
                  {reenrolSubmitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="mr-2 h-4 w-4" />
                  )}
                  เริ่มย้าย
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {phase === 'enabled' && (
          <Card className="rounded-lg border-border bg-card shadow-none">
            <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
              <CardTitle className="text-sm font-medium text-foreground">
                ปิดใช้งาน MFA
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 p-6">
              <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  การปิด MFA จะลด security ของบัญชี ถ้าเปลี่ยนโทรศัพท์ให้ใช้การย้ายด้านบนแทน
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                ใส่รหัส 6 หลักปัจจุบันจากแอป Authenticator เพื่อยืนยันว่าเป็นคุณ
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="max-w-xs flex-1">
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={disableCodeInput}
                    onChange={(e) => setDisableCodeInput(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    className="text-center font-mono text-lg tracking-widest"
                    disabled={disableSubmitting}
                  />
                </div>
                <Button
                  variant="destructive"
                  onClick={() => void handleDisable()}
                  disabled={disableSubmitting || disableCodeInput.length !== 6}
                >
                  {disableSubmitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ShieldOff className="mr-2 h-4 w-4" />
                  )}
                  ปิดใช้งาน MFA
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ProviderLayout>
  );
}
