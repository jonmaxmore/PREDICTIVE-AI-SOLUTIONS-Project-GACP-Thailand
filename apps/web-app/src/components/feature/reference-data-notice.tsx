import { Info } from 'lucide-react';

/**
 * Formal advisory notice for reference/assessment data that is preliminary and
 * has not (yet) been formally verified by a domain expert.
 *
 * HONEST-BY-DESIGN: the copy states the data is เพื่อประกอบการพิจารณา
 * (for consideration) and ควรยืนยันกับผู้เชี่ยวชาญ (should be confirmed with an
 * expert) — it does NOT claim expert certification. Used on the herb knowledge
 * DB (ต้นแบบ 5) and the image assessment pages (ต้นแบบ 6), both of which are
 * advisory tools that never make the final decision.
 */
export function ReferenceDataNotice({
  title = 'ข้อมูลอ้างอิงเพื่อประกอบการพิจารณาเบื้องต้น',
  body = 'ข้อมูลองค์ความรู้ในระบบนี้จัดทำขึ้นเพื่อใช้เป็นข้อมูลอ้างอิงเบื้องต้นประกอบการพิจารณา อยู่ระหว่างการตรวจสอบและปรับปรุงความถูกต้องโดยผู้เชี่ยวชาญและหน่วยงานที่เกี่ยวข้อง โปรดยืนยันกับผู้เชี่ยวชาญหรือเอกสารมาตรฐานที่เกี่ยวข้องก่อนนำข้อมูลไปใช้อ้างอิงอย่างเป็นทางการ',
}: {
  title?: string;
  body?: string;
}) {
  return (
    <div
      role="note"
      className="mt-4 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900"
    >
      <Info className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs leading-relaxed text-amber-800">{body}</p>
      </div>
    </div>
  );
}
