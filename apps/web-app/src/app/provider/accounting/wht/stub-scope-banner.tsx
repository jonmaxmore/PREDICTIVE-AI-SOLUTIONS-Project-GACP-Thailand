'use client';

import { IconAlertTriangle } from '@tabler/icons-react';

/**
 * StubScopeBanner — amber callout explaining the WHT service is an
 * intentional stub.
 *
 * The platform DOES NOT:
 *   - Auto-deduct 3% at point of sale
 *   - Emit ภ.ง.ด.53 monthly remittance file
 *   - Auto-generate ทบ.50 ทวิ certificates
 *
 * The platform DOES:
 *   - Record ทบ.50 ทวิ certificates the corporate buyer mailed in
 *   - Probe whether WHT is applicable for a given invoice
 *
 * Owner directive (verbatim Thai, 2026-05-15):
 * "ถ้าหัก 3% แล้วเสี่ยงผิดกฎหมาย หรือเราไม่ได้นำส่ง เอาออกก็ได้"
 *
 * Reference: apps/backend/services/wht-service.js lines 30-86
 * ("What this service explicitly DOES NOT do").
 *
 * Per R1-D requirements this banner is ALWAYS rendered at the top of
 * the WHT client view so finance staff cannot accidentally treat the
 * record-cert workflow as a remittance pipeline.
 */
export function StubScopeBanner() {
    return (
        <section
            role="note"
            aria-label="ขอบเขตของระบบ WHT"
            className="rounded-lg border border-amber-300 bg-amber-50 p-5"
        >
            <div className="flex items-start gap-3">
                <IconAlertTriangle
                    size={24}
                    className="mt-0.5 shrink-0 text-amber-700"
                    aria-hidden="true"
                />
                <div className="min-w-0 flex-1 space-y-2 text-sm text-amber-900">
                    <p className="font-bold">
                        ขอบเขตของระบบ WHT (ภาษีหัก ณ ที่จ่าย 3%)
                    </p>
                    <p>
                        ระบบนี้ใช้สำหรับ <b>บันทึก</b> หนังสือรับรองการหักภาษี ณ ที่จ่าย
                        (ทบ.50 ทวิ) ที่ผู้ซื้อนิติบุคคลส่งกลับมาให้ฝ่ายการเงินของแพลตฟอร์มเท่านั้น
                    </p>
                    <ul className="ml-5 list-disc space-y-1 text-amber-800">
                        <li>
                            ระบบ <b>ไม่</b> หัก 3% อัตโนมัติที่จุดขาย ใบกำกับภาษีของแพลตฟอร์มออกเต็มจำนวน
                            (subtotal + VAT 7%) เสมอ
                        </li>
                        <li>
                            ระบบ <b>ไม่</b> ออกแบบ ภ.ง.ด.53 รายเดือน หน้าที่นำส่งเป็นของผู้ซื้อนิติบุคคล
                            (ป.รัษฎากร ม.50, ม.59)
                        </li>
                        <li>
                            ระบบ <b>ไม่</b> ออก ทบ.50 ทวิ ผู้ซื้อเป็นผู้ออกเอกสารส่งกลับมา
                            (ป.รัษฎากร ม.69 ทวิ)
                        </li>
                    </ul>
                    <p className="text-xs text-amber-800">
                        หมายเหตุ: รายละเอียดทางกฎหมายและเหตุผลที่เป็น STUB อ้างอิงไฟล์
                        <code className="mx-1 rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px]">
                            apps/backend/services/wht-service.js
                        </code>
                        บรรทัด 30-86 (§ &quot;Why this is a STUB&quot; และ &quot;What this service explicitly DOES NOT do&quot;)
                    </p>
                </div>
            </div>
        </section>
    );
}

export default StubScopeBanner;
