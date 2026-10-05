'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Download, BookOpen,
  Sprout, Scissors, Sun, Shield, Beaker, Package,
  Info,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { SummaryHeader } from '@/components/feature';

interface SOPTemplate {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** จำนวนหน้าโดยประมาณ */
  pages: string;
  /** ประเภทไฟล์ที่ให้ดาวน์โหลด */
  format: 'PDF' | 'DOCX' | 'PDF+DOCX';
  /** บังคับหรือแนะนำ */
  required: boolean;
  /** GACP ข้อกำหนดที่เกี่ยวข้อง */
  gacpRef?: string;
}

const SOP_TEMPLATES: SOPTemplate[] = [
  {
    id: 'sop-planting',
    title: 'SOP การเพาะปลูกสมุนไพร',
    description: 'มาตรฐานการเพาะปลูก: การเตรียมดิน, การเพาะกล้า, การปลูก, ระยะห่าง, การให้น้ำ',
    icon: Sprout,
    pages: '8-10',
    format: 'PDF+DOCX',
    required: true,
    gacpRef: 'GACP ข้อ 5.1-5.3',
  },
  {
    id: 'sop-harvest',
    title: 'SOP การเก็บเกี่ยว',
    description: 'ขั้นตอนการเก็บเกี่ยว: ช่วงเวลาที่เหมาะสม, วิธีการเก็บ, การคัดแยก, การบันทึก',
    icon: Scissors,
    pages: '6-8',
    format: 'PDF+DOCX',
    required: true,
    gacpRef: 'GACP ข้อ 6.1-6.2',
  },
  {
    id: 'sop-drying',
    title: 'SOP การตากแห้ง/อบแห้ง',
    description: 'วิธีการทำแห้งสมุนไพร: อุณหภูมิ, ระยะเวลา, ความชื้นที่เหมาะสม, การตรวจสอบ',
    icon: Sun,
    pages: '5-7',
    format: 'PDF+DOCX',
    required: true,
    gacpRef: 'GACP ข้อ 7.1-7.3',
  },
  {
    id: 'sop-hygiene',
    title: 'SOP สุขลักษณะและสุขอนามัย',
    description: 'มาตรฐานสุขลักษณะ: ความสะอาดพื้นที่, สุขอนามัยผู้ปฏิบัติงาน, การป้องกันสัตว์/แมลง',
    icon: Shield,
    pages: '8-10',
    format: 'PDF+DOCX',
    required: true,
    gacpRef: 'GACP ข้อ 8.1-8.4',
  },
  {
    id: 'sop-storage',
    title: 'SOP การเก็บรักษาและบรรจุ',
    description: 'การเก็บรักษาสมุนไพรแห้ง: สภาพคลังสินค้า, การบรรจุ, การติดฉลาก, อายุการเก็บ',
    icon: Package,
    pages: '6-8',
    format: 'PDF+DOCX',
    required: true,
    gacpRef: 'GACP ข้อ 9.1-9.3',
  },
  {
    id: 'sop-quality',
    title: 'SOP การควบคุมคุณภาพ',
    description: 'ขั้นตอนตรวจสอบคุณภาพ: การสุ่มตัวอย่าง, การส่งตรวจ, เกณฑ์การยอมรับ, การจัดการของเสีย',
    icon: Beaker,
    pages: '7-9',
    format: 'PDF+DOCX',
    required: false,
    gacpRef: 'GACP ข้อ 10.1-10.2',
  },
  {
    id: 'sop-record',
    title: 'SOP การบันทึกข้อมูลและย้อนกลับ',
    description: 'ระบบบันทึก: บันทึกการผลิต, Lot/Batch tracking, การย้อนกลับได้ (Traceability)',
    icon: BookOpen,
    pages: '5-6',
    format: 'PDF+DOCX',
    required: false,
    gacpRef: 'GACP ข้อ 11.1',
  },
];

export default function SOPTemplatesPage() {
  const [downloading, setDownloading] = useState<string | null>(null);

  const handleDownload = async (template: SOPTemplate, _format: 'pdf' | 'docx') => {
    setDownloading(`${template.id}-${_format}`);

    // Generate SOP template as downloadable HTML file (printable)
    const sopContent = generateSOPTemplate(template);
    const blob = new Blob([sopContent], { type: 'text/html; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SOP_${template.id}_template.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDownloading(null);
  };

  const generateSOPTemplate = (template: SOPTemplate): string => {
    return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<title>${template.title}</title>
<style>
  body { font-family: 'Sarabun', 'TH SarabunPSK', sans-serif; max-width: 800px; margin: 0 auto; padding: 40px; font-size: 14pt; line-height: 1.8; }
  h1 { text-align: center; font-size: 18pt; margin-bottom: 5px; }
  h2 { font-size: 16pt; border-bottom: 2px solid #333; padding-bottom: 5px; margin-top: 30px; }
  .header { text-align: center; margin-bottom: 30px; border-bottom: 3px double #333; padding-bottom: 15px; }
  .header p { margin: 3px 0; }
  .meta { display: flex; justify-content: space-between; margin: 15px 0; }
  .meta-item { flex: 1; }
  .field { margin: 10px 0; }
  .field-label { font-weight: bold; }
  .field-line { border-bottom: 1px dotted #999; min-height: 25px; margin-left: 5px; display: inline-block; width: 70%; }
  table { width: 100%; border-collapse: collapse; margin: 15px 0; }
  th, td { border: 1px solid #333; padding: 8px; text-align: left; }
  th { background: #f0f0f0; }
  .section { margin: 20px 0; }
  .footer { margin-top: 50px; display: flex; justify-content: space-between; }
  .signature { text-align: center; width: 200px; }
  .signature-line { border-top: 1px solid #333; margin-top: 60px; padding-top: 5px; }
  .ref { color: #666; font-size: 11pt; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>
<div class="header">
  <p style="font-size:12pt; color:#666;">มาตรฐานการปฏิบัติงาน (Standard Operating Procedure)</p>
  <h1>${template.title}</h1>
  <p class="ref">อ้างอิง: ${template.gacpRef} หลักเกณฑ์วิธีการที่ดีในการเพาะปลูกและการเก็บเกี่ยวสมุนไพร (GACP)</p>
</div>

<div class="meta">
  <div class="meta-item"><span class="field-label">เลขที่เอกสาร:</span> <span class="field-line">SOP-___-001</span></div>
  <div class="meta-item"><span class="field-label">ฉบับที่:</span> <span class="field-line">1</span></div>
</div>
<div class="meta">
  <div class="meta-item"><span class="field-label">วันที่จัดทำ:</span> <span class="field-line">___/___/______</span></div>
  <div class="meta-item"><span class="field-label">วันที่แก้ไขล่าสุด:</span> <span class="field-line">___/___/______</span></div>
</div>
<div class="meta">
  <div class="meta-item"><span class="field-label">ชื่อสถานประกอบการ/ฟาร์ม:</span> <span class="field-line"></span></div>
</div>

<h2>1. วัตถุประสงค์</h2>
<div class="section">
  <p>เพื่อกำหนดขั้นตอนและวิธีการมาตรฐานในการ${template.title.replace('SOP ', '')} ตามหลักเกณฑ์ GACP</p>
  <div class="field"><span class="field-label">วัตถุประสงค์เพิ่มเติม:</span><br><span class="field-line" style="width:100%; display:block; min-height:50px;"></span></div>
</div>

<h2>2. ขอบเขต</h2>
<div class="section">
  <div class="field"><span class="field-label">ขอบเขตการใช้งาน:</span><br><span class="field-line" style="width:100%; display:block; min-height:50px;"></span></div>
  <div class="field"><span class="field-label">พื้นที่ที่ครอบคลุม:</span> <span class="field-line"></span></div>
</div>

<h2>3. ผู้รับผิดชอบ</h2>
<div class="section">
  <table>
    <tr><th style="width:40%">บทบาท</th><th>ชื่อ-สกุล</th><th style="width:25%">ตำแหน่ง</th></tr>
    <tr><td>ผู้จัดทำ</td><td></td><td></td></tr>
    <tr><td>ผู้ตรวจสอบ</td><td></td><td></td></tr>
    <tr><td>ผู้อนุมัติ</td><td></td><td></td></tr>
    <tr><td>ผู้ปฏิบัติงาน</td><td></td><td></td></tr>
  </table>
</div>

<h2>4. ขั้นตอนการปฏิบัติ</h2>
<div class="section">
  <table>
    <tr><th style="width:8%">ลำดับ</th><th>ขั้นตอน</th><th style="width:20%">ผู้รับผิดชอบ</th><th style="width:20%">ข้อควรระวัง</th></tr>
    <tr><td>1</td><td></td><td></td><td></td></tr>
    <tr><td>2</td><td></td><td></td><td></td></tr>
    <tr><td>3</td><td></td><td></td><td></td></tr>
    <tr><td>4</td><td></td><td></td><td></td></tr>
    <tr><td>5</td><td></td><td></td><td></td></tr>
    <tr><td>6</td><td></td><td></td><td></td></tr>
    <tr><td>7</td><td></td><td></td><td></td></tr>
    <tr><td>8</td><td></td><td></td><td></td></tr>
  </table>
</div>

<h2>5. อุปกรณ์/วัสดุที่ใช้</h2>
<div class="section">
  <table>
    <tr><th style="width:8%">ลำดับ</th><th>รายการ</th><th style="width:15%">จำนวน</th><th style="width:30%">หมายเหตุ</th></tr>
    <tr><td>1</td><td></td><td></td><td></td></tr>
    <tr><td>2</td><td></td><td></td><td></td></tr>
    <tr><td>3</td><td></td><td></td><td></td></tr>
    <tr><td>4</td><td></td><td></td><td></td></tr>
  </table>
</div>

<h2>6. จุดควบคุมวิกฤต (Critical Control Points)</h2>
<div class="section">
  <table>
    <tr><th style="width:8%">ลำดับ</th><th>จุดควบคุม</th><th style="width:25%">ค่ามาตรฐาน</th><th style="width:20%">ความถี่ตรวจ</th></tr>
    <tr><td>1</td><td></td><td></td><td></td></tr>
    <tr><td>2</td><td></td><td></td><td></td></tr>
    <tr><td>3</td><td></td><td></td><td></td></tr>
  </table>
</div>

<h2>7. การบันทึกข้อมูล</h2>
<div class="section">
  <table>
    <tr><th style="width:8%">ลำดับ</th><th>แบบบันทึก/แบบฟอร์ม</th><th style="width:20%">ระยะเวลาเก็บ</th></tr>
    <tr><td>1</td><td></td><td></td></tr>
    <tr><td>2</td><td></td><td></td></tr>
    <tr><td>3</td><td></td><td></td></tr>
  </table>
</div>

<h2>8. เอกสารอ้างอิง</h2>
<div class="section">
  <p>• หลักเกณฑ์วิธีการที่ดีในการเพาะปลูกและเก็บเกี่ยวสมุนไพร (GACP) ระบบรับรองมาตรฐาน GACP สมุนไพร</p>
  <p>• ${template.gacpRef}</p>
  <p>• พ.ร.บ.ผลิตภัณฑ์สมุนไพร พ.ศ. 2562</p>
</div>

<div class="footer">
  <div class="signature">
    <div class="signature-line">ผู้จัดทำ</div>
    <p>วันที่ ___/___/______</p>
  </div>
  <div class="signature">
    <div class="signature-line">ผู้ตรวจสอบ</div>
    <p>วันที่ ___/___/______</p>
  </div>
  <div class="signature">
    <div class="signature-line">ผู้อนุมัติ</div>
    <p>วันที่ ___/___/______</p>
  </div>
</div>

<p style="text-align:center; color:#999; font-size:10pt; margin-top:30px;">
  สร้างโดยระบบ GACP Certification Platform กรุณาเปิดในเบราว์เซอร์แล้วพิมพ์เป็น PDF (Ctrl+P)
</p>
</body>
</html>`;
  };

  return (
    // Wave E.2-B: SummaryHeader replaces inline title; animate-fade-in
    // + pb-20 already provided by DashboardLayout main.
    <div className="space-y-6">
      <SummaryHeader
        eyebrow="ผู้ขอรับรอง · แบบฟอร์ม SOP"
        title="แบบฟอร์ม SOP สำหรับ GACP"
        description="ดาวน์โหลดแบบฟอร์ม SOP (Standard Operating Procedure) สำหรับใช้ประกอบการขอรับรองมาตรฐาน GACP"
        metrics={[
          { label: 'แบบฟอร์ม', value: SOP_TEMPLATES.length.toLocaleString('th-TH'), icon: '📋' },
        ]}
      />

      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
        <div className="text-xs text-blue-700">
          <p className="font-bold">คำแนะนำ</p>
          <p className="mt-1">
            ดาวน์โหลดแบบฟอร์มเป็น Word (.docx) เพื่อแก้ไขตามข้อมูลฟาร์มของคุณ แล้วแปลงเป็น PDF
            เพื่ออัปโหลดในขั้นตอนยื่นคำขอ แบบฟอร์มที่มีเครื่องหมาย <strong>บังคับ</strong> ต้องแนบทุกฉบับ
          </p>
        </div>
      </div>

      {/* Template List */}
      <div className="space-y-3">
        {SOP_TEMPLATES.map((template, idx) => (
          <motion.div
            key={template.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            className="rounded-xl border border-border bg-card p-4"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-leaf-soft text-leaf-onSoft">
                <template.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold text-foreground">{template.title}</h3>
                  {template.required ? (
                    <Badge className="rounded-full border-none bg-red-100 px-2 py-0 text-[10px] font-bold text-red-700">
                      บังคับ
                    </Badge>
                  ) : (
                    <Badge className="rounded-full border-none bg-zinc-100 px-2 py-0 text-[10px] font-bold text-zinc-500">
                      แนะนำ
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{template.description}</p>
                {template.gacpRef && (
                  <p className="mt-1 text-[10px] font-medium text-primary">
                    อ้างอิง: {template.gacpRef}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 min-h-[44px] gap-1.5 rounded-full text-xs sm:min-h-0"
                    disabled={downloading === `${template.id}-pdf`}
                    onClick={() => handleDownload(template, 'pdf')}
                  >
                    {downloading === `${template.id}-pdf` ? (
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                    PDF
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 min-h-[44px] gap-1.5 rounded-full text-xs sm:min-h-0"
                    disabled={downloading === `${template.id}-docx`}
                    onClick={() => handleDownload(template, 'docx')}
                  >
                    {downloading === `${template.id}-docx` ? (
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                    Word
                  </Button>
                  <span className="text-[10px] text-muted-foreground">
                    ~{template.pages} หน้า
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Footer note */}
      <p className="text-center text-[10px] text-muted-foreground">
        แบบฟอร์ม SOP อิงตามมาตรฐาน GACP (Good Agricultural and Collection Practices) ของ GACP Thaiฯ
      </p>
    </div>
  );
}
