/**
 * CAR Report Service
 * Generates Corrective Action Request PDFs for failed audit items
 */

const pdfGenerator = require('./pdf-generator.service');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { createLogger } = require('../../shared/logger');
const { formatThaiDateFull } = require('../../utils/thai-format');
const { localYear } = require('../../utils/working-days');
const logger = createLogger('car-service');

class CARReportService {
    constructor() {
        this.storageDir = path.join(__dirname, '../../storage/reports/car');
    }

    async ensureStorageDir() {
        try {
            await fs.access(this.storageDir);
        } catch {
            await fs.mkdir(this.storageDir, { recursive: true });
        }
    }

    /**
     * Generate CAR Report PDF
     * @param {Object} carData - CAR data
     */
    async generateCARReport(carData) {
        const htmlContent = this.generateCARHTML(carData);
        return await pdfGenerator.generatePDF(htmlContent, {
            headerTemplate: `
                <div style="font-size: 10px; text-align: center; width: 100%; color: #666;">
                    GACP Thaiฯ | Corrective Action Request
                </div>
            `,
        });
    }

    /**
     * Generate and save CAR to file
     */
    async generateAndSaveCARReport(carData) {
        await this.ensureStorageDir();
        const pdfBuffer = await this.generateCARReport(carData);
        const filename = `CAR_${carData.carNumber}_${Date.now()}.pdf`;
        const filePath = path.join(this.storageDir, filename);
        await fs.writeFile(filePath, pdfBuffer);
        logger.info(`CAR report generated: ${filename}`);
        return { filePath, filename, buffer: pdfBuffer };
    }

    /**
     * Generate CAR HTML template
     */
    generateCARHTML(data) {
        const {
            carNumber,
            auditNumber,
            applicationNumber,
            applicantName,
            farmName,
            auditDate,
            auditorName,
            failedItems = [],
            deadline,
            issuedAt = new Date(),
        } = data;

        // SEC-001: applicant- and auditor-supplied values (farm name, applicant
        // name, free-text CAR notes, checklist titles) are concatenated straight
        // into this HTML string, which goes to generatePDF() un-templated — so
        // every interpolated value is HTML-escaped here.
        const esc = (v) => pdfGenerator.escapeHtml(v);

        // "17 กันยายน 2569" — the Bangkok day, not the container clock's
        // (CODE-01, audit 2026-09-17).
        const formatDate = formatThaiDateFull;

        return `
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <style>
    /* Sarabun is embedded locally, not imported. The vendored woff2 faces in
       assets/fonts/sarabun are base64-inlined as data: URIs and injected into
       <head> by pdf-generator.service.js (this HTML goes through
       pdfGenerator.generatePDF below), so no font URL is needed here. The
       @import that used to pull Sarabun from a foreign font CDN on every
       render was removed 2026-07-25 so the render has no remote font
       dependency; the renderer now allows only data: + about:blank. */

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Sarabun', sans-serif; font-size: 11pt; color: #1e293b; line-height: 1.6; }
    
    .container { max-width: 750px; margin: 0 auto; padding: 20px; }
    
    .header { text-align: center; border-bottom: 3px solid #dc2626; padding-bottom: 15px; margin-bottom: 20px; }
    .header h1 { font-size: 18pt; color: #dc2626; }
    .header h2 { font-size: 12pt; color: #64748b; font-weight: normal; }
    .car-number { background: #dc2626; color: white; padding: 5px 15px; border-radius: 5px; display: inline-block; margin-top: 10px; font-size: 14pt; font-weight: bold; }
    
    .alert-box { background: #fef2f2; border: 2px solid #dc2626; border-radius: 8px; padding: 15px; margin-bottom: 20px; }
    .alert-box h3 { color: #dc2626; margin-bottom: 10px; }
    
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px; }
    .meta-item { background: #f8fafc; padding: 10px; border-radius: 5px; }
    .meta-label { color: #64748b; font-size: 10pt; }
    .meta-value { font-weight: 600; }
    
    .section { margin-bottom: 20px; }
    .section-title { font-size: 12pt; font-weight: 700; color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 5px; margin-bottom: 10px; }
    
    table { width: 100%; border-collapse: collapse; font-size: 10pt; }
    th { background: #dc2626; color: white; text-align: left; padding: 8px; }
    td { border: 1px solid #e2e8f0; padding: 8px; }
    tr:nth-child(even) { background: #f8fafc; }
    
    .action-box { background: #fffbeb; border: 1px solid #fbbf24; border-radius: 8px; padding: 15px; margin-bottom: 15px; }
    .action-box h4 { color: #92400e; margin-bottom: 5px; }
    
    .deadline-box { background: #fee2e2; border: 2px solid #dc2626; border-radius: 8px; padding: 15px; text-align: center; margin-bottom: 20px; }
    .deadline-box .date { font-size: 16pt; font-weight: bold; color: #dc2626; }
    
    .signature-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; margin-top: 40px; }
    .signature-item { text-align: center; }
    .signature-line { border-top: 1px solid #1e293b; width: 80%; margin: 60px auto 5px; }
    .signature-label { color: #64748b; font-size: 10pt; }
    
    .footer { text-align: center; margin-top: 30px; padding-top: 15px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 9pt; }
    
    .checkbox { display: inline-block; width: 15px; height: 15px; border: 2px solid #64748b; margin-right: 5px; vertical-align: middle; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚠️ แบบขอให้แก้ไขข้อบกพร่อง</h1>
      <h2>Corrective Action Request (CAR)</h2>
      <div class="car-number">${esc(carNumber || 'CAR-XXXX')}</div>
    </div>
    
    <div class="alert-box">
      <h3>⚠️ ข้อบกพร่องที่ต้องแก้ไข</h3>
      <p>ตามผลการตรวจประเมินพบข้อบกพร่องที่ต้องดำเนินการแก้ไข โปรดดำเนินการแก้ไขภายในระยะเวลาที่กำหนด</p>
    </div>
    
    <div class="meta-grid">
      <div class="meta-item">
        <div class="meta-label">เลขที่การตรวจ</div>
        <div class="meta-value">${esc(auditNumber || '-')}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">เลขที่ใบสมัคร</div>
        <div class="meta-value">${esc(applicationNumber || '-')}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">ผู้ประกอบการ</div>
        <div class="meta-value">${esc(applicantName || '-')}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">ชื่อแปลง/ฟาร์ม</div>
        <div class="meta-value">${esc(farmName || '-')}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">วันที่ตรวจ</div>
        <div class="meta-value">${formatDate(auditDate)}</div>
      </div>
      <div class="meta-item">
        <div class="meta-label">ผู้ตรวจ</div>
        <div class="meta-value">${esc(auditorName || '-')}</div>
      </div>
    </div>
    
    <div class="deadline-box">
      <p>⏰ กำหนดแก้ไขภายใน</p>
      <div class="date">${formatDate(deadline)}</div>
      <p style="font-size: 10pt; color: #991b1b; margin-top: 5px;">หากไม่ดำเนินการภายในกำหนด จะถือว่าไม่ผ่านการตรวจประเมิน</p>
    </div>
    
    <div class="section">
      <div class="section-title">📋 รายการที่ต้องแก้ไข (${failedItems.length} รายการ)</div>
      <table>
        <thead>
          <tr>
            <th style="width: 10%;">#</th>
            <th style="width: 15%;">รหัส</th>
            <th style="width: 45%;">รายการ</th>
            <th style="width: 30%;">หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>
          ${failedItems.map((item, idx) => `
            <tr>
              <td style="text-align: center;">${idx + 1}</td>
              <td>${esc(item.itemCode)}</td>
              <td>${esc(item.titleTh || item.title || '-')}</td>
              <td>${esc(item.notes || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    
    <div class="section">
      <div class="section-title">✍️ แนวทางการแก้ไข</div>
      ${failedItems.map((item, idx) => `
        <div class="action-box">
          <h4>${idx + 1}. ${esc(item.itemCode)}: ${esc(item.titleTh || item.title)}</h4>
          <p><strong>สาเหตุ:</strong> ${esc(item.notes || 'ไม่ผ่านเกณฑ์การตรวจ')}</p>
          <p><strong>แนวทางแก้ไข:</strong> ________________________________________</p>
          <p><strong>หลักฐาน:</strong> <span class="checkbox"></span>รูปถ่าย <span class="checkbox"></span>เอกสาร <span class="checkbox"></span>อื่น ๆ _______</p>
        </div>
      `).join('')}
    </div>
    
    <div class="signature-grid">
      <div class="signature-item">
        <div class="signature-line"></div>
        <strong>ผู้ตรวจประเมิน</strong>
        <div class="signature-label">${esc(auditorName || '-')}</div>
      </div>
      <div class="signature-item">
        <div class="signature-line"></div>
        <strong>ผู้รับการตรวจ</strong>
        <div class="signature-label">${esc(applicantName || '-')}</div>
      </div>
      <div class="signature-item">
        <div class="signature-line"></div>
        <strong>ผู้อนุมัติ</strong>
        <div class="signature-label">วันที่: ___/___/______</div>
      </div>
    </div>
    
    <div class="footer">
      <p>เอกสารนี้ออกโดยระบบ GACP Platform | วันที่ออก: ${formatDate(issuedAt)}</p>
      <p>ระบบรับรองมาตรฐาน GACP สมุนไพร | GACP Thai Platform</p>
    </div>
  </div>
</body>
</html>
        `;
    }

    /**
     * Generate CAR number
     */
    generateCARNumber(_auditNumber) {
        const year = localYear() + 543; // Buddhist year, Bangkok calendar
        const random = crypto.randomInt(10_000).toString().padStart(4, '0');
        return `CAR-${year}-${random}`;
    }
}

module.exports = new CARReportService();

