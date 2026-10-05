'use client';

export const dynamic = 'force-dynamic';

import { useRouter } from 'next/navigation';
import { ShieldCheck, ChevronLeft } from 'lucide-react';

import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import { SummaryHeader } from '@/components/feature';

// มติ operator 2026-09-15: ผู้ขอรับรองยืนยันตัวตนผ่าน หมอพร้อม หรือ ThaID ไม่มีล็อกอินด้วยอีเมล
// และไม่มีการยืนยัน 2 ขั้นตอนทางอีเมลอีกต่อไป หน้านี้เคยเป็นแบบฟอร์มเปิด/ปิด 2FA แบบส่งรหัสทางอีเมล
// ซึ่ง endpoint ฝั่ง backend ถูกปลดออกทั้งชุดแล้ว เส้นทางยังอยู่เพราะเมนูโปรไฟล์ชี้มาที่นี่
//
// review 2026-09-16: ข้อความต้องไม่สัญญาสิ่งที่ระบบไม่ได้ทำ การเข้าสู่ระบบใหม่ไม่ได้ยกเลิกเซสชันเดิม
// (มีแค่การเปลี่ยนรหัสผ่าน การเปลี่ยนสถานะ/บทบาทโดยเจ้าหน้าที่ และ PDPA ที่ประทับ
// sessionsRevokedAt) และ /api/auth/idp/providers บน demo/staging วันที่ 16 ก.ย. ตอบว่า local เปิดอยู่
// ส่วน healthid/providerid/thaid ยังเป็น coming_soon — ผู้ขอรับรองเข้าด้วยเลขบัตร + รหัสผ่านอยู่
// จึงห้ามเขียนว่า หมอพร้อม / ThaID ยืนยันตัวตนให้แล้ว
//
// มติ operator 2026-09-17 "เราไม่มีการกู้บัญชี": ไม่มีการรีเซ็ตรหัสผ่านไม่ว่าช่องทางใด (token ที่เจ้าหน้าที่
// ออกให้ก็ถูกถอดแล้ว) หน้านี้จึงไม่บอกให้ "ติดต่อเจ้าหน้าที่" เมื่อเข้าสู่ระบบไม่ได้ เพราะเจ้าหน้าที่ไม่มีทางพาเข้าได้
// สิ่งที่ผู้ใช้ทำได้จริงคือเปลี่ยนรหัสผ่านขณะยังเข้าสู่ระบบอยู่ (/health/settings)
export default function HealthSecurityPage() {
  const router = useRouter();

  return (
    <div className="w-full space-y-6 p-4 pb-20 md:p-6 md:pb-6">
      <SummaryHeader
        eyebrow="ผู้ขอรับรอง · ความปลอดภัย"
        title="การยืนยันตัวตน"
        description="ระบบนี้ไม่มีรหัสยืนยันทางอีเมล และไม่มีการกู้บัญชี"
        actions={
          <Button
            variant="ghost"
            size="sm"
            className="rounded-xl"
            onClick={() => router.push('/health/profile')}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            กลับ
          </Button>
        }
      />

      <Card className="rounded-2xl border-border bg-card shadow-sm">
        <CardHeader className="border-b border-border/50 bg-muted/30 px-6 py-4">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            ความปลอดภัยของบัญชี
          </CardTitle>
        </CardHeader>
        {/* sm:pt-6: the primitive's own sm:pt-0 survives a bare p-6 and glued the text to the divider */}
        <CardContent className="space-y-3 p-6 text-sm text-muted-foreground sm:pt-6">
          <p>
            ตอนนี้ผู้ขอรับรองเข้าสู่ระบบด้วยเลขบัตรประชาชนและรหัสผ่าน การเข้าสู่ระบบด้วย{' '}
            <span className="font-semibold text-foreground">หมอพร้อม</span> และ{' '}
            <span className="font-semibold text-foreground">ThaID</span> ยังไม่เปิดใช้
          </p>
          <p>ระบบนี้ไม่มีการยืนยันตัวตนสองขั้นตอนทางอีเมล จึงไม่มีสิ่งใดให้ตั้งค่าในหน้านี้</p>
          <p>
            ระบบนี้ไม่มีการกู้บัญชี หากจำรหัสผ่านไม่ได้ จะตั้งรหัสผ่านใหม่ไม่ได้ กรุณาเก็บรหัสผ่านไว้ให้ดี
          </p>
          <p>หากสงสัยว่ามีผู้อื่นรู้รหัสผ่านของคุณ ให้เปลี่ยนรหัสผ่านทันที</p>
        </CardContent>
      </Card>
    </div>
  );
}
