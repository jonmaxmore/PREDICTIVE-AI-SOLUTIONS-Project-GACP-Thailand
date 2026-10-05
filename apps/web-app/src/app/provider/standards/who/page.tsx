'use client';

/**
 * สัญญา C05F680149 ต้นแบบที่ 1.1 — "ระบบวิเคราะห์มาตรฐาน WHO"
 * (ต้นแบบระบบวิเคราะห์มาตรฐาน GACP 3 ระบบ · THRSP)
 *
 * วิเคราะห์ข้อกำหนด WHO Guidelines on GACP เทียบสถานะจริงของคำขอ/เกษตรกร
 * และแนะนำแนวทางการปรับปรุง — ชื่อหน้านี้ล็อกตามถ้อยคำสัญญา (naming lock,
 * สัญญา C05F680149 ข้อ 0).
 */

import ProviderLayout from '../../components/provider-layout';
import StandardAnalyzeView from '../_components/standard-analyze-view';

export default function WhoStandardPage() {
  return (
    <ProviderLayout heading title="ระบบวิเคราะห์มาตรฐาน WHO" subtitle="WHO GACP Standard Analysis · THRSP ต้นแบบที่ 1.1">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 lg:px-8">
        <p className="mb-6 text-sm text-muted-foreground">
          วิเคราะห์ข้อกำหนด WHO Guidelines on Good Agricultural and Collection Practices (GACP)
          เปรียบเทียบกับสถานะปัจจุบันของคำขอรับรอง พร้อมคำแนะนำแนวทางการปรับปรุง
        </p>
        <StandardAnalyzeView standardCode="WHO" />
      </div>
    </ProviderLayout>
  );
}
