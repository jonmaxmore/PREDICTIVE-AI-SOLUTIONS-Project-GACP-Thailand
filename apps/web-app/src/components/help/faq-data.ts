/**
 * faq-data.ts — Iter 28 FAQ content (Thai).
 *
 * Centralised Q&A entries organised by topic. The help center
 * landing, /help/faq, and any inline help drawer can all consume
 * this source so the answers stay consistent across surfaces.
 *
 * Content owner: Customer Success
 * Update cadence: every iteration as policy / fee schedule shifts.
 */

import type { FaqItem } from './FaqAccordion';
// Fee answers take their amounts from the served fees (GET /api/pricing/fees,
// passed in as FeesState) and never from a constant: the answers once carried
// the totals of a retired formula (W14, F-G4-64 T9), and a constant would go
// stale the day a fee changes in the fee engine (config/business-rules.js;
// SystemConfig fee.* rows are not applied, operator 2026-10-03). Without served
// fees an answer carries feesNotice(state) and no number.
import {
    feesNotice,
    formatBaht,
    vatPercentLabel,
    type FeesState,
} from '@/lib/pricing/public-fees';
// Operator decision 6 (2026-09-17), audit UXUI-01 / UXUI-X2: the payee, the
// payment rail, the refund rule and certificate validity are stated from ONE
// module whose every line names its record. This file used to carry its own
// answers: the state fee paid to the Comptroller General and a technical fee to
// the CB (retired by W14), an instant PromptPay QR plus Mobile Banking (the web
// shows no QR; the rail is Stripe PromptPay only), partial refunds in 15-30
// working days via a form (payment-terms v1.1 says none of that), a document
// update for renewal (W12: no document review) and a paid third inspection (no
// such fee state exists).
import {
    CAR_REVISION_DEADLINE_TH,
    CERTIFICATE_VALIDITY_TH,
    ONLINE_PAYMENT_STEP_TH,
    PAYEE_STATEMENT_TH,
    PAYMENT_CHANNEL_TH,
    REFUND_POLICY_TH,
    REFUND_REQUEST_TH,
    RENEWAL_PROCESS_TH,
    RENEWAL_REMINDER_DAYS_TH,
    RENEWAL_WINDOW_TH,
} from '@/constants/service-facts';
import { PRIVACY_EMAIL } from '@/constants/contact-emails';
import { FEE_SERVICES_FALLBACK, SERVICE_NAME } from '@/lib/pricing/fee-services';

export type FaqTopic = {
    id: string;
    title: string;
    description: string;
    items: ReadonlyArray<FaqItem>;
};

function scopeFeeSentence(state: FeesState): string {
    if (state.status !== 'ready') return `${feesNotice(state)} `;
    const { fees } = state;
    // Names: the server's catalogue when served, else the one web mirror (operator 2026-10-03).
    const services = fees.services ?? FEE_SERVICES_FALLBACK;
    return `${services.PHASE_1.name} ${formatBaht(fees.phase1TotalPerScope)} บาทต่อขอบเขต `
        + `และ${services.PHASE_2.name} ${formatBaht(fees.phase2TotalPerScope)} บาทต่อขอบเขต `
        // One ค่าบริการ plus VAT (operator 2026-09-11): the first port of this
        // line said the sum held a state fee and a platform fee, a split that
        // ruling retired.
        + `สองยอดนี้คือค่าบริการรวม VAT ${vatPercentLabel(fees)} แล้ว `;
}

function renewalFeeSentence(state: FeesState): string {
    if (state.status !== 'ready') return feesNotice(state);
    return `${formatBaht(state.fees.renewalTotalPerScope)} บาทต่อรูปแบบการปลูก`;
}

/**
 * The FAQ with its fee answers built from the served fees. The FAQ page
 * renders this with usePricing().state.
 */
export function buildFaqTopics(state: FeesState): ReadonlyArray<FaqTopic> {
    return [
    {
        id: 'application',
        title: 'การสมัคร',
        description: 'การเตรียมเอกสาร การกรอกข้อมูล และเงื่อนไขผู้สมัคร',
        items: [
            {
                id: 'app-docs',
                question: 'ใช้เอกสารอะไรบ้างในการสมัคร?',
                answer:
                    'เอกสารหลัก ได้แก่ สำเนาบัตรประชาชน สำเนาทะเบียนบ้าน เอกสารสิทธิ์ที่ดิน (โฉนด/นส.3/สัญญาเช่า) แผนผังฟาร์ม รูปถ่ายแปลงปลูก และรายการพืชสมุนไพรที่ขอรับรอง สำหรับนิติบุคคลเพิ่มหนังสือรับรองและสำเนา ภพ.20',
                keywords: ['เอกสาร', 'document', 'ยื่น'],
            },
            {
                id: 'app-entity',
                question: 'สมัครได้ทั้งบุคคลธรรมดาและนิติบุคคลใช่หรือไม่?',
                answer:
                    'ใช่ ผู้สมัครสามารถเป็นบุคคลธรรมดา วิสาหกิจชุมชน สหกรณ์ หรือบริษัทจำกัดได้ แต่ละประเภทใช้ชุดเอกสารต่างกัน ระบบจะแสดงรายการที่ต้องเตรียมตามประเภทที่เลือก',
                keywords: ['บุคคล', 'นิติบุคคล', 'วิสาหกิจ'],
            },
            {
                id: 'app-multi-plant',
                question: 'ต้องสมัครซ้ำทุกพืชสมุนไพรหรือไม่?',
                answer:
                    'ไม่ต้องสมัครแยกต่อพืช แต่ละคำขอครอบคลุมหลายชนิดพืชภายในฟาร์มเดียวกัน อย่างไรก็ตามแต่ละชนิดพืชอาจมีเกณฑ์การตรวจประเมินเพิ่มเติม',
                keywords: ['พืช', 'หลายชนิด'],
            },
            {
                id: 'app-multi-farm',
                question: 'ฟาร์มหลายแปลงต้องยื่นกี่คำขอ?',
                answer:
                    'หลักการคือ 1 ฟาร์ม = 1 คำขอ = 1 ใบรับรอง หากมีหลายแปลงในที่ตั้งใกล้กันสามารถรวมเป็นคำขอเดียวได้ หากอยู่คนละจังหวัดต้องแยกคำขอ',
                keywords: ['ฟาร์ม', 'แปลง', 'หลายแปลง'],
            },
            {
                id: 'app-edit',
                question: 'สามารถแก้ไขคำขอหลังจากยื่นแล้วได้หรือไม่?',
                answer:
                    'ก่อนเจ้าหน้าที่ตรวจสอบ สามารถถอนคำขอเพื่อแก้ไขแล้วยื่นใหม่ได้ หากเจ้าหน้าที่มีคำสั่งให้แก้ไข (CAR) ระบบจะเปิดให้แก้ไขเฉพาะส่วนที่ระบุ',
                keywords: ['แก้ไข', 'edit', 'CAR'],
            },
            {
                id: 'app-time',
                question: 'ระยะเวลาตั้งแต่ยื่นถึงรับใบรับรองนานเท่าไหร่?',
                answer:
                    'โดยทั่วไป 45-90 วันทำการ ขึ้นกับความครบถ้วนของเอกสาร การนัดตรวจฟาร์ม และการชำระเงินตามงวด',
                keywords: ['เวลา', 'นาน', 'ระยะเวลา'],
            },
        ],
    },
    {
        id: 'payment',
        title: 'การชำระเงิน',
        description: 'ค่าบริการ งวดการชำระ ช่องทาง และใบเสร็จ',
        items: [
            {
                id: 'pay-two-installments',
                question: 'ทำไมต้องชำระเงิน 2 ครั้งต่อหนึ่งคำขอ?',
                answer:
                    `ค่าบริการแบ่งเป็น${SERVICE_NAME.PHASE_1} ชำระหลังยื่นคำขอและยอมรับใบเสนอราคา และ${SERVICE_NAME.PHASE_2} ชำระเมื่อเอกสารผ่านการตรวจแล้ว ก่อนนัดตรวจประเมิน การแบ่งจ่ายช่วยให้ผู้สมัครไม่ต้องวางเงินก้อนใหญ่ทีเดียว`,
                keywords: ['งวด', 'แบ่งจ่าย', 'สองงวด'],
            },
            {
                id: 'pay-state-fee',
                question: 'ค่าบริการชำระให้ใคร?',
                answer: PAYEE_STATEMENT_TH,
                keywords: ['ค่าบริการ', 'ค่าธรรมเนียม', 'ผู้รับเงิน', 'บริษัท', 'รัฐ', 'กรมบัญชีกลาง'],
            },
            {
                id: 'pay-promptpay',
                question: 'ชำระเงินได้ช่องทางใดบ้าง?',
                answer: `${PAYMENT_CHANNEL_TH} ${ONLINE_PAYMENT_STEP_TH}`,
                keywords: ['promptpay', 'qr', 'โอน'],
            },
            {
                id: 'pay-refund',
                question: 'ขอคืนเงินได้หรือไม่?',
                answer: `${REFUND_POLICY_TH[0]} ดูเงื่อนไขทั้งหมดในหัวข้อ "การคืนเงิน"`,
                keywords: ['คืนเงิน', 'refund'],
            },
            {
                id: 'pay-scope-fee',
                question: 'ค่าบริการต่อ scope คือเท่าไหร่?',
                answer:
                    scopeFeeSentence(state)
                    // Per CULTIVATION SCOPE: business-rules.js FEES (operator
                    // 2026-08-22 "ต้องคิดเงินแยกรูปแบบการปลูก").
                    + 'หนึ่งขอบเขตคือหนึ่งรูปแบบการปลูก คำขอที่มีหลายรูปแบบการปลูกคิดตามจำนวนรูปแบบ '
                    + 'ยอดที่ต้องชำระจริงยึดตามใบเสนอราคาที่คุณกดยอมรับ',
                keywords: ['scope', 'ขอบเขต', 'ค่าธรรมเนียม'],
            },
        ],
    },
    {
        id: 'audit',
        title: 'การตรวจฟาร์ม',
        description: 'ขั้นตอน ระยะเวลา การเตรียมตัว และการตรวจซ้ำ',
        items: [
            {
                id: 'audit-duration',
                question: 'การตรวจฟาร์มใช้เวลานานเท่าไหร่?',
                answer:
                    'โดยทั่วไป 0.5-1 วันต่อฟาร์ม ขึ้นกับขนาดพื้นที่และจำนวนชนิดพืช เจ้าหน้าที่จะตรวจเอกสาร พื้นที่ปลูก ระบบน้ำ การจัดเก็บ และการเก็บเกี่ยว',
                keywords: ['ตรวจ', 'audit', 'เวลา'],
            },
            {
                id: 'audit-presence',
                question: 'ผู้สมัครต้องอยู่ที่ฟาร์มด้วยหรือไม่?',
                answer:
                    'ต้องมีผู้สมัครหรือผู้รับมอบอำนาจอยู่ในวันตรวจ เพื่อให้ข้อมูล ตอบคำถาม และนำชมพื้นที่ หากไม่มีผู้แทน เจ้าหน้าที่ขอเลื่อนการตรวจ',
                keywords: ['ผู้สมัคร', 'อยู่', 'ฟาร์ม'],
            },
            {
                id: 'audit-fail',
                question: 'หากไม่ผ่านการตรวจ ต้องเริ่มใหม่หรือไม่?',
                answer:
                    `ไม่ต้องเริ่มใหม่ เจ้าหน้าที่จะออกคำสั่งให้แก้ไข (CAR) ภายใน ${CAR_REVISION_DEADLINE_TH} ผู้สมัครต้องดำเนินการแก้ไขและส่งหลักฐาน หากแก้ไขผ่านสามารถเข้าสู่ขั้นออกใบรับรองได้`,
                keywords: ['ไม่ผ่าน', 'CAR', 'แก้ไข'],
            },
            {
                id: 'audit-recheck',
                question: 'การตรวจซ้ำเสียค่าบริการเพิ่มหรือไม่?',
                // The fee states are the two instalments only
                // (workflow-transition-service.js: none inside the CAR loop), and
                // the resubmission fee was retired (business-rules.js PAYMENT,
                // R2 M6 / D-2). A rejected application ends; a new one is billed.
                answer:
                    'ไม่ ระบบเรียกเก็บค่าบริการเพียง 2 งวดต่อคำขอ ไม่มีค่าตรวจซ้ำและไม่มีค่ายื่นแก้ไข หากคำขอไม่ผ่านและต้องยื่นคำขอใหม่ คำขอใหม่มีค่าบริการตามอัตราปกติ',
                keywords: ['ตรวจซ้ำ', 'recheck'],
            },
            {
                id: 'audit-schedule',
                question: 'จะรู้วันนัดตรวจได้อย่างไร?',
                answer:
                    'เจ้าหน้าที่จะนัดหมายล่วงหน้าไม่น้อยกว่า 7 วันทำการผ่านระบบ (แจ้งเตือนในระบบเท่านั้น) สามารถดูปฏิทินการตรวจในหน้า "คำขอของฉัน"',
                keywords: ['นัด', 'ตรวจ', 'schedule'],
            },
        ],
    },
    {
        id: 'certificate',
        title: 'ใบรับรอง',
        description: 'การออก ดาวน์โหลด สูญหาย และการตรวจสอบใบรับรอง',
        items: [
            {
                id: 'cert-format',
                question: 'ใบรับรองอยู่ในรูปแบบใด?',
                answer:
                    'ใบรับรองดิจิทัล (PDF) พร้อมลายเซ็นอิเล็กทรอนิกส์ของผู้มีอำนาจ และ QR Code สำหรับตรวจสอบความถูกต้อง ฉบับพิมพ์ใช้ดาวน์โหลดจากระบบเองได้',
                keywords: ['รูปแบบ', 'pdf', 'ดิจิทัล'],
            },
            {
                id: 'cert-lost',
                question: 'หากใบรับรองสูญหายต้องทำอย่างไร?',
                answer:
                    'ดาวน์โหลดสำเนาใหม่ได้ทันทีจากหน้า "ใบรับรอง" เนื่องจากใบรับรองเป็นดิจิทัล จึงไม่มีปัญหาสูญหาย กรณีต้องการใบใหม่ที่มีตราประทับสามารถยื่นคำร้องขอออกซ้ำได้',
                keywords: ['หาย', 'lost', 'ออกซ้ำ'],
            },
            {
                id: 'cert-verify',
                question: 'ใครสามารถตรวจสอบใบรับรองได้?',
                answer:
                    'ผู้ที่มี QR Code หรือเลขที่ใบรับรองสามารถตรวจสอบผ่านหน้า /verify ของระบบได้ ไม่ต้องลงชื่อเข้าใช้ การตรวจสอบจะแสดงสถานะ (Active / Expired) และข้อมูลฟาร์มสาธารณะ',
                keywords: ['ตรวจสอบ', 'verify', 'qr'],
            },
            {
                id: 'cert-validity',
                question: 'ใบรับรองมีอายุนานแค่ไหน?',
                answer:
                    `${CERTIFICATE_VALIDITY_TH} ต้องยื่นต่ออายุก่อนใบรับรองหมดอายุ `
                    + `มีการแจ้งเตือนในระบบล่วงหน้า ${RENEWAL_REMINDER_DAYS_TH} วันก่อนหมดอายุ`,
                keywords: ['อายุ', 'validity'],
            },
            {
                id: 'cert-renewal',
                question: 'การต่ออายุยุ่งยากเหมือนสมัครใหม่ไหม?',
                answer:
                    `ไม่ ระบบดึงข้อมูลฟาร์มจากคำขอเดิมมาให้ ${RENEWAL_PROCESS_TH} `
                    + `${renewalFeeSentence(state)} ${RENEWAL_WINDOW_TH}`,
                keywords: ['ต่ออายุ', 'renewal'],
            },
        ],
    },
    {
        id: 'refund',
        title: 'การคืนเงิน',
        description: 'เงื่อนไขและวิธีขอคืนเงิน',
        items: [
            {
                id: 'refund-conditions',
                question: 'เงื่อนไขการคืนเงินมีอะไรบ้าง?',
                // docs/legal/payment-terms-th-v1.2.md §7 and §10, the terms accepted
                // before every payment.
                answer: REFUND_POLICY_TH.join(' '),
                keywords: ['เงื่อนไข', 'คืนเงิน'],
            },
            {
                id: 'refund-process',
                question: 'ต้องทำอย่างไรเพื่อขอคืนเงิน?',
                answer: REFUND_REQUEST_TH,
                keywords: ['ขอคืน', 'process'],
            },
        ],
    },
    {
        id: 'pdpa',
        title: 'PDPA และความเป็นส่วนตัว',
        description: 'การเก็บข้อมูล สิทธิเจ้าของข้อมูล และการลบบัญชี',
        items: [
            {
                id: 'pdpa-storage',
                question: 'ข้อมูลของผู้สมัครถูกเก็บไว้อย่างไร?',
                answer:
                    'เข้ารหัสทั้งระหว่างส่งและขณะจัดเก็บ (TLS + AES-256) เฉพาะเจ้าหน้าที่ที่ได้รับอนุญาตเท่านั้นเข้าถึงได้',
                keywords: ['เก็บ', 'storage', 'pdpa'],
            },
            {
                id: 'pdpa-delete',
                question: 'ขอลบบัญชีและข้อมูลส่วนบุคคลได้หรือไม่?',
                answer:
                    `ได้ ผู้ใช้สามารถยื่นคำขอลบบัญชีผ่านอีเมล ${PRIVACY_EMAIL} โดยข้อมูลที่กฎหมายกำหนดให้เก็บ (เช่น เอกสารใบรับรอง 5 ปี) จะถูกเก็บแยกเป็นข้อมูลที่ไม่ใช้ระบุตัวบุคคล`,
                keywords: ['ลบ', 'delete', 'บัญชี'],
            },
            {
                id: 'pdpa-rights',
                question: 'มีสิทธิอะไรบ้างในฐานะเจ้าของข้อมูล?',
                answer:
                    'มีสิทธิเข้าถึงข้อมูลของตนเอง ขอแก้ไข ขอลบ ขอระงับการประมวลผล และขอเคลื่อนย้ายข้อมูล ตาม พรบ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562',
                keywords: ['สิทธิ', 'rights', 'pdpa'],
            },
            {
                id: 'pdpa-cookie',
                question: 'เว็บไซต์ใช้คุกกี้อะไรบ้าง?',
                answer:
                    'ใช้คุกกี้จำเป็น (Session, CSRF) เท่านั้น ไม่มี Tracking หรือ Advertising Cookies ดูรายละเอียดได้ในหน้านโยบายคุกกี้',
                keywords: ['cookie', 'คุกกี้'],
            },
        ],
    },
    ];
}

/** Flat list of FAQ items, for search across topics. */
export function flattenFaqItems(topics: ReadonlyArray<FaqTopic>): ReadonlyArray<FaqItem & { topicId: string }> {
    return topics.flatMap((topic) => topic.items.map((item) => ({ ...item, topicId: topic.id })));
}

/**
 * The FAQ's structure (topics, titles, counts) for pages that list topics but
 * print no answer, e.g. the help home. Built without served fees, so its fee
 * answers carry the notice and no amount; a page that renders answers uses
 * buildFaqTopics(usePricing().state) instead.
 */
export const FAQ_TOPICS: ReadonlyArray<FaqTopic> = buildFaqTopics({ status: 'unavailable' });

/** Flat list of FAQ_TOPICS items. */
export const ALL_FAQ_ITEMS: ReadonlyArray<FaqItem & { topicId: string }> = flattenFaqItems(FAQ_TOPICS);

/** Compute total count statically — used for telemetry headlines. */
export const FAQ_COUNT = ALL_FAQ_ITEMS.length;

/** Glossary entries — Thai accounting + GACP terms. */
export type GlossaryEntry = {
    id: string;
    /** Thai display form. Leads in Thai; carries an acronym only where the
     *  acronym is the legal name printed on the document itself. */
    term: string;
    /** English display form. */
    termEn: string;
    definition: string;
    definitionEn: string;
    /** Acronyms and spellings the search box must still match even when the
     *  active language no longer shows them. Translating the display must
     *  not quietly break how people look a term up. */
    aliases?: readonly string[];
    category: 'finance' | 'gacp' | 'audit' | 'general';
};

export const GLOSSARY_ENTRIES: ReadonlyArray<GlossaryEntry> = [
    {
        id: 'gacp',
        term: 'มาตรฐานการปฏิบัติทางการเกษตรและการเก็บเกี่ยวที่ดี (GACP)',
        termEn: 'GACP (Good Agricultural and Collection Practices)',
        definition:
            'มาตรฐานการปฏิบัติทางการเกษตรและการเก็บเกี่ยวที่ดีสำหรับพืชสมุนไพร กำกับดูแลโดยกรมการแพทย์แผนไทยและการแพทย์ทางเลือก',
        definitionEn:
            'The good agricultural and collection practice standard for herbal crops, administered by the Department of Thai Traditional and Alternative Medicine.',
        aliases: ['GACP'],
        category: 'gacp',
    },
    {
        id: 'scope',
        term: 'ขอบเขตการรับรอง',
        termEn: 'Scope',
        definition:
            'ชุดของชนิดพืช พื้นที่ และกระบวนการที่ยื่นขอใบรับรอง หนึ่งขอบเขตคิดค่าบริการหนึ่งรายการ',
        definitionEn:
            'The set of crop types, areas, and processes covered by one certificate application. Each scope is charged as one fee item.',
        aliases: ['Scope'],
        category: 'gacp',
    },
    {
        id: 'car',
        term: 'คำสั่งแก้ไขข้อบกพร่อง',
        termEn: 'Corrective Action Request (CAR)',
        definition:
            'คำสั่งให้แก้ไขที่ออกหลังการตรวจประเมิน ระบุข้อบกพร่อง ระดับความรุนแรง และกำหนดเวลาที่ต้องดำเนินการ',
        definitionEn:
            'An instruction issued after an audit, stating the finding, its severity, and the deadline for putting it right.',
        aliases: ['CAR', 'Corrective Action Request'],
        category: 'audit',
    },
    {
        id: 'surveillance',
        term: 'การตรวจติดตามผล',
        termEn: 'Surveillance Audit',
        definition:
            'การตรวจติดตามประจำปีสำหรับผู้ที่ได้รับใบรับรองแล้ว เพื่อยืนยันว่ายังปฏิบัติตามมาตรฐานอย่างต่อเนื่อง',
        definitionEn:
            'The annual follow-up audit for certificate holders, confirming that the standard is still being met.',
        aliases: ['Surveillance Audit'],
        category: 'audit',
    },
    {
        id: 'cb',
        term: 'หน่วยรับรองมาตรฐาน',
        termEn: 'Certification Body (CB)',
        definition:
            'องค์กรอิสระที่ได้รับการรับรองให้ประเมินและออกใบรับรองมาตรฐาน',
        definitionEn:
            'The independent organisation accredited to assess applicants and issue the standard certificate.',
        aliases: ['CB', 'Certification Body'],
        category: 'gacp',
    },
    {
        id: 'invoice',
        term: 'ใบแจ้งหนี้',
        termEn: 'Invoice',
        definition:
            'เอกสารเรียกเก็บเงินก่อนชำระ ระบุยอด เลขที่อ้างอิง และวันครบกำหนด แต่ละงวดจะมีใบแจ้งหนี้แยก',
        definitionEn:
            'The demand for payment issued before you pay, stating the amount, reference number, and due date. Each instalment has its own invoice.',
        aliases: ['Invoice'],
        category: 'finance',
    },
    {
        id: 'tax-invoice',
        term: 'ใบกำกับภาษี',
        termEn: 'Tax Invoice',
        definition:
            'เอกสารทางภาษีที่ระบุยอดภาษีมูลค่าเพิ่มร้อยละ 7 สำหรับนิติบุคคลที่จดทะเบียนภาษีมูลค่าเพิ่ม ใช้ขอคืนภาษีซื้อ',
        definitionEn:
            'The tax document stating the 7% value added tax, used by VAT-registered companies to reclaim input tax.',
        aliases: ['Tax Invoice', 'VAT'],
        category: 'finance',
    },
    {
        id: 'wht',
        term: 'ภาษีหัก ณ ที่จ่าย',
        termEn: 'Withholding Tax (WHT)',
        definition:
            'ภาษีที่หักไว้ตามประมวลรัษฎากร โดยทั่วไปร้อยละ 3 สำหรับค่าบริการ ผู้จ่ายมีหน้าที่นำส่งกรมสรรพากร',
        definitionEn:
            'Tax withheld at source under the Revenue Code, generally 3% on service fees. The payer is responsible for remitting it to the Revenue Department.',
        aliases: ['WHT', 'Withholding Tax'],
        category: 'finance',
    },
    {
        id: 'pdpa',
        term: 'พระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล (PDPA)',
        termEn: 'Personal Data Protection Act (PDPA)',
        definition:
            'กฎหมายคุ้มครองข้อมูลส่วนบุคคลของประเทศไทย พ.ศ. 2562 กำหนดสิทธิของเจ้าของข้อมูลและหน้าที่ของผู้ควบคุมข้อมูล',
        definitionEn:
            "Thailand's personal data protection law of 2019, setting out the rights of data subjects and the duties of data controllers.",
        aliases: ['PDPA'],
        category: 'general',
    },
    {
        id: 'promptpay',
        term: 'พร้อมเพย์',
        termEn: 'PromptPay',
        definition:
            'บริการโอนเงินของระบบธนาคารไทย โดยใช้เลขประจำตัวประชาชน เบอร์โทรศัพท์ หรือเลขกระเป๋าเงินอิเล็กทรอนิกส์',
        definitionEn:
            'The Thai banking transfer service addressed by national ID number, phone number, or e-wallet number.',
        aliases: ['PromptPay'],
        category: 'finance',
    },
];
