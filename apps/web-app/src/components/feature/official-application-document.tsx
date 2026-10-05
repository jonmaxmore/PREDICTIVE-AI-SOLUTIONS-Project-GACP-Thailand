'use client';

import { cn } from '@/lib/utils';
import { DTAM_ORG } from '@/config/document-config';
import type {
  OfficialApplicationDocumentProps,
  OfficialDocumentAttachment,
} from './official-application-document.types';

export type {
  OfficialApplicationDocumentProps,
  OfficialDocumentAttachment,
  OfficialDocumentMeta,
  OfficialDocumentRow,
  OfficialDocumentSection,
} from './official-application-document.types';

/* ----------------------------------------------------------------
   Helpers
   ---------------------------------------------------------------- */

function renderValue(value: string): string {
  return value && value.trim().length > 0 ? value : '-';
}

function attachmentStatusClasses(uploaded: boolean): string {
  return uploaded
    ? 'border border-leaf-300 bg-leaf-soft text-leaf-onSoft'
    : 'border border-amber-200 bg-amber-50 text-amber-800';
}

function isLikelyImage(attachment: OfficialDocumentAttachment): boolean {
  const source = `${attachment.url || ''} ${attachment.name || ''}`.toLowerCase();
  return /\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/i.test(source);
}

function isLikelyPdf(attachment: OfficialDocumentAttachment): boolean {
  const source = `${attachment.url || ''} ${attachment.name || ''}`.toLowerCase();
  return /\.pdf(\?|$)/i.test(source);
}

/* ================================================================
   OfficialApplicationDocument
   ----------------------------------------------------------------
   GACP Application preview in DTAM official A4 paper format.
   100% Tailwind CSS — no raw CSS classes or inline styles.
   Config-driven — org info from document-config.ts.
   ================================================================ */

export function OfficialApplicationDocument({
  org = DTAM_ORG,
  documentTitle,
  documentSubtitle,
  metadata,
  sections,
  attachments,
  applicantBranch,
  onPrint,
  showPrintButton = true,
}: OfficialApplicationDocumentProps) {
  const uploadedImageAttachments = attachments.filter(
    (a) => a.uploaded && a.url && isLikelyImage(a),
  );
  const uploadedPdfAttachments = attachments.filter(
    (a) => a.uploaded && a.url && isLikelyPdf(a),
  );

  /** Filter sections by applicant branch (conditional rendering) */
  const visibleSections = sections.filter((section) => {
    if (!section.applicantBranch || section.applicantBranch.length === 0) return true;
    if (!applicantBranch) return true;
    return section.applicantBranch.includes(applicantBranch);
  });

  return (
    <div className="bg-gray-100 p-6 print:bg-white print:p-0" id="official-doc-wrapper">
      {/* Print Button */}
      {showPrintButton && (
        <div className="mx-auto mb-4 flex max-w-[210mm] justify-end gap-3 print:hidden">
          <button
            type="button"
            onClick={onPrint}
            className="rounded-lg bg-leaf-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-leaf-800"
          >
            🖨️ พิมพ์ / ส่งออก PDF
          </button>
        </div>
      )}

      {/* A4 Page */}
      <div
        className="relative mx-auto min-h-[297mm] w-[210mm] bg-white px-[20mm] py-[20mm] text-sm leading-relaxed text-black shadow-lg print:m-0 print:min-h-0 print:w-full print:shadow-none"
        id="official-application-document"
        style={{ fontFamily: "'Sarabun', 'TH Sarabun New', 'TH SarabunPSK', sans-serif", fontSize: '14pt', lineHeight: 1.4 }}
      >
        {/* ---- Header: Logo + Dept Info + Badge ---- */}
        <header className="mb-4 flex items-start justify-between gap-4">
          <div className="flex flex-1 gap-3">
            {/* Logo — no border, clean professional look */}
            <div className="flex h-[60px] w-[60px] shrink-0 items-center justify-center overflow-hidden rounded-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={org.logoPath}
                alt={`ตราสัญลักษณ์${org.department}`}
                width="56"
                height="56"
                className="object-contain"
              />
            </div>
            {/* Department Info */}
            <div className="text-xs">
              <div className="text-sm font-bold">{org.division}</div>
              <div>{org.department}</div>
              <div className="text-[11pt]">{org.address}</div>
              <div className="text-[11pt]">โทรศัพท์ {org.phone} อีเมล {org.email}</div>
            </div>
          </div>
          {/* Badge */}
          <div className="shrink-0 whitespace-nowrap rounded-lg bg-leaf-800 px-5 py-2 text-center text-base font-bold text-white">
            {documentTitle}
          </div>
        </header>

        {/* ---- Document Subtitle ---- */}
        {documentSubtitle && (
          <p className="mb-3 text-center text-xs text-gray-500">
            {documentSubtitle}
          </p>
        )}

        {/* ---- Metadata Grid ---- */}
        <table className="mb-4 w-full border-collapse text-xs">
          <tbody>
            {metadata.map((item, i) => (
              <tr key={`meta-${i}`}>
                <td className="w-[35%] border border-gray-300 bg-gray-50 px-2 py-1.5 font-semibold">
                  {item.label}
                </td>
                <td className="border border-gray-300 px-2 py-1.5">
                  {renderValue(item.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ---- Sections ---- */}
        {visibleSections.map((section, sectionIndex) => (
          <div key={section.key} className="mb-3">
            {/* Section Header */}
            <div className="rounded-t-md bg-leaf-800 px-3 py-1.5 text-xs font-bold text-white">
              {sectionIndex + 1}. {section.title}
            </div>
            {section.subtitle && (
              <div className="bg-gray-100 px-3 py-1 text-[10pt] text-gray-500">
                {section.subtitle}
              </div>
            )}
            {/* Section Rows */}
            <table className="w-full border-collapse text-[11pt]">
              <tbody>
                {section.rows.length > 0 ? (
                  section.rows.map((row, rowIndex) => (
                    <tr key={`${section.key}-${row.path || row.label}-${rowIndex}`}>
                      <td className="w-[35%] border border-gray-300 bg-gray-50 px-2 py-1.5 font-medium">
                        {row.label}
                      </td>
                      <td className="whitespace-pre-wrap break-words border border-gray-300 px-2 py-1.5">
                        {renderValue(row.value)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="border border-gray-300 bg-gray-50 px-2 py-1.5 font-medium">
                      (ไม่มีข้อมูลในหัวข้อนี้)
                    </td>
                    <td className="border border-gray-300 px-2 py-1.5">-</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ))}

        {/* ---- Attachments Table ---- */}
        <div className="mb-3 mt-4">
          <div className="rounded-t-md bg-leaf-800 px-3 py-1.5 text-xs font-bold text-white">
            รายการเอกสารแนบ
          </div>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="w-[8%] border border-gray-300 bg-leaf-800 px-2 py-1.5 text-center font-bold text-white">ลำดับ</th>
                <th className="border border-gray-300 bg-leaf-800 px-2 py-1.5 text-center font-bold text-white">ประเภท</th>
                <th className="border border-gray-300 bg-leaf-800 px-2 py-1.5 text-center font-bold text-white">ชื่อเอกสาร</th>
                <th className="w-[15%] border border-gray-300 bg-leaf-800 px-2 py-1.5 text-center font-bold text-white">สถานะ</th>
                <th className="w-[10%] border border-gray-300 bg-leaf-800 px-2 py-1.5 text-center font-bold text-white print:hidden">เปิดไฟล์</th>
              </tr>
            </thead>
            <tbody>
              {attachments.length > 0 ? (
                attachments.map((attachment, index) => (
                  <tr key={`${attachment.type}-${attachment.name}-${index}`}>
                    <td className="border border-gray-300 px-2 py-1.5 text-center">{index + 1}</td>
                    <td className="border border-gray-300 px-2 py-1.5">{attachment.type || '-'}</td>
                    <td className="border border-gray-300 px-2 py-1.5">{attachment.name || '-'}</td>
                    <td className="border border-gray-300 px-2 py-1.5">
                      <span className={cn('inline-flex rounded px-2 py-0.5 text-xs font-medium', attachmentStatusClasses(attachment.uploaded))}>
                        {attachment.uploaded ? 'อัปโหลดแล้ว' : 'ยังไม่อัปโหลด'}
                      </span>
                      {attachment.required && (
                        <span className="ml-1 inline-flex rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800">
                          บังคับ
                        </span>
                      )}
                    </td>
                    <td className="border border-gray-300 px-2 py-1.5 text-center print:hidden">
                      <button
                        type="button"
                        disabled={!attachment.url}
                        onClick={() => attachment.url && window.open(attachment.url, '_blank', 'noopener,noreferrer')}
                        className="rounded border border-gray-300 bg-white px-2.5 py-1 text-[10pt] transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        เปิด
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="border border-gray-300 px-2 py-1.5 text-center text-gray-400">
                    ไม่พบรายการเอกสารแนบ
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* ---- Image Previews ---- */}
        {uploadedImageAttachments.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 rounded-t-md bg-leaf-800 px-3 py-1.5 text-xs font-bold text-white">
              พรีวิวไฟล์ (รูปภาพ)
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
              {uploadedImageAttachments.map((attachment, index) => (
                <figure key={`${attachment.url}-${index}`} className="m-0 rounded-lg border border-gray-300 p-2">
                  <div className="aspect-[4/3] overflow-hidden border border-gray-300 bg-gray-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={attachment.url}
                      alt={attachment.name || `รูปเอกสาร ${index + 1}`}
                      className="h-full w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                  <figcaption className="mt-1 text-[10pt]">
                    <div className="font-semibold">{attachment.name || '-'}</div>
                    <div>ประเภท: {attachment.type || '-'}</div>
                    <button
                      type="button"
                      className="mt-1 rounded border border-gray-400 bg-white px-2.5 py-0.5 text-[10pt] transition-colors hover:bg-gray-50 print:hidden"
                      onClick={() => attachment.url && window.open(attachment.url, '_blank', 'noopener,noreferrer')}
                    >
                      เปิดรูปภาพ
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        )}

        {/* ---- PDF Previews ---- */}
        {uploadedPdfAttachments.length > 0 && (
          <div className="mb-4 print:hidden">
            <div className="mb-2 rounded-t-md bg-leaf-800 px-3 py-1.5 text-xs font-bold text-white">
              พรีวิวไฟล์ (PDF)
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
              {uploadedPdfAttachments.map((attachment, index) => (
                <div key={`${attachment.url}-pdf-${index}`} className="rounded-lg border border-gray-300 p-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <div>
                      <div className="text-[11pt] font-semibold">{attachment.name || '-'}</div>
                      <div className="text-[10pt] text-gray-500">ประเภท: {attachment.type || 'PDF'}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => attachment.url && window.open(attachment.url, '_blank', 'noopener,noreferrer')}
                      className="rounded border border-gray-400 bg-white px-2.5 py-1 text-[10pt] transition-colors hover:bg-gray-50"
                    >
                      เปิด PDF
                    </button>
                  </div>
                  <iframe
                    title={attachment.name || `PDF ${index + 1}`}
                    src={`${attachment.url}#toolbar=0&navpanes=0&scrollbar=0`}
                    className="h-[420px] w-full border border-gray-300"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---- Signature Block ---- */}
        <div className="mt-8 flex justify-between gap-4 text-xs">
          <div className="flex-1 rounded-lg border border-gray-300 px-3 py-4 text-center">
            <div className="mb-8 text-[11pt] font-bold">ลายมือชื่อผู้ยื่นคำขอ</div>
            <div className="mb-1">.............................................</div>
            <div className="mb-1">(...............................................)</div>
            <div className="mt-2 text-[11pt]">วันที่........../............./.............</div>
          </div>
          <div className="flex-1 rounded-lg border border-gray-300 px-3 py-4 text-center">
            <div className="mb-8 text-[11pt] font-bold">ลายมือชื่อเจ้าหน้าที่รับคำขอ</div>
            <div className="mb-1">.............................................</div>
            <div className="mb-1">(...............................................)</div>
            <div className="mt-2 text-[11pt]">วันที่........../............./.............</div>
          </div>
        </div>

        {/* ---- Disclaimer ---- */}
        <div className="mt-6 border-t border-gray-300 pt-3 text-[10pt] text-gray-700">
          ผู้ยื่นคำขอยืนยันว่าข้อมูลและเอกสารที่ปรากฏในเอกสารฉบับนี้เป็นข้อมูลที่ใช้ประกอบการยื่นคำขอรับรอง
          และยินยอมให้หน่วยงานที่เกี่ยวข้องตรวจสอบข้อมูลและหลักฐานตามระเบียบที่กำหนด
        </div>
      </div>

      {/* ---- Print Styles ---- */}
      <style jsx global>{`
        @media print {
          html, body { background: #ffffff !important; }
          body * { visibility: hidden !important; }
          #official-application-document, #official-application-document * { visibility: visible !important; }
          #official-application-document {
            position: absolute !important;
            inset: 0 auto auto 0 !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 15mm 20mm !important;
            border: 0 !important;
            box-shadow: none !important;
            background: #fff !important;
          }
          #official-application-document img {
            max-width: 100% !important;
            max-height: 180mm !important;
            object-fit: contain !important;
          }
        }
      `}</style>
    </div>
  );
}

export default OfficialApplicationDocument;
