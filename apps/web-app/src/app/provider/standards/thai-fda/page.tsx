'use client';

/**
 * สัญญา C05F680149 ต้นแบบที่ 1.2 — "ระบบวิเคราะห์มาตรฐาน Thai FDA"
 * (ต้นแบบระบบวิเคราะห์มาตรฐาน GACP 3 ระบบ · THRSP)
 *
 * วิเคราะห์ข้อกำหนดของ อย. ไทย / ประกาศกรมการแพทย์แผนไทยฯ ตรวจสอบความพร้อม
 * การขอใบรับรอง และจัดทำ checklist อัตโนมัติ — องค์ประกอบ checklist/เอกสารบังคับ
 * ตัวเต็มคือ workflow ตรวจคำขอที่ LIVE อยู่แล้ว (หน้ารายละเอียดคำขอ) หน้านี้เป็น
 * มุมมอง gap-analysis ต่อมาตรฐาน THAI_GACP ที่ seed ไว้.
 */

import Link from 'next/link';
import ProviderLayout from '../../components/provider-layout';
import StandardAnalyzeView from '../_components/standard-analyze-view';

export default function ThaiFdaStandardPage() {
  return (
    <ProviderLayout heading title="ระบบวิเคราะห์มาตรฐาน Thai FDA" subtitle="Thai FDA / DTAM GACP Readiness · THRSP ต้นแบบที่ 1.2">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 lg:px-8">
        <p className="mb-2 text-sm text-muted-foreground">
          วิเคราะห์ข้อกำหนดของ อย. ไทย / ประกาศกรมการแพทย์แผนไทยและการแพทย์ทางเลือก
          ตรวจสอบความพร้อมการขอใบรับรอง พร้อม checklist อัตโนมัติ
        </p>
        <p className="mb-6 text-sm text-muted-foreground">
          checklist เอกสารบังคับรายคำขอ + ประวัติการตรวจ ดูได้ที่หน้า{' '}
          <Link href="/provider/applications" className="text-primary underline underline-offset-2">
            คำขอรับรอง
          </Link>{' '}
           หน้านี้สรุปช่องว่างเทียบมาตรฐาน Thai GACP
        </p>
        <StandardAnalyzeView standardCode="THAI_GACP" />
      </div>
    </ProviderLayout>
  );
}
