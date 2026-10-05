'use strict';

/**
 * ตารางเปรียบเทียบมาตรฐาน GACP/สมุนไพร 10 ประเทศอาเซียน
 * (สัญญา C05F680149 ต้นแบบที่ 1.3 — ระบบเปรียบเทียบมาตรฐาน ASEAN:
 *  "เปรียบเทียบมาตรฐาน 10 ประเทศอาเซียน · วิเคราะห์ช่องว่างและโอกาส ·
 *   แนะนำตลาดเป้าหมาย")
 *
 * ข้อมูลอ้างอิงเรียบเรียงโดยทีมพัฒนา ณ ก.ค. 2569 จากกรอบ ASEAN GHP/TMHS
 * (Traditional Medicines and Health Supplements) + ระเบียบรายประเทศที่เผยแพร่
 * สาธารณะ — **ทีมวิจัย SSRU ต้องตรวจทานความถูกต้องก่อนใช้ในรายงานฉบับสมบูรณ์**
 * (สถานะ regulatory เปลี่ยนได้; แถวไทยคือ baseline ที่ระบบนี้ประเมินให้อยู่แล้ว)
 *
 * ทุกแถว: gapVsThai = ช่องว่างที่เกษตรกร/ผู้ประกอบการไทยต้องปิดเพิ่มจาก Thai
 * GACP เพื่อเข้าตลาดนั้น · opportunity = โอกาสตลาดสำหรับสมุนไพร 6 ชนิดเป้าหมาย
 * (กัญชา ขมิ้นชัน ขิง กระชายดำ ไพล กระท่อม)
 */

const ASEAN_COMPARISON = [
    {
        countryCode: 'TH',
        country: 'Thailand',
        countryTH: 'ไทย',
        regulator: 'กรมการแพทย์แผนไทยและการแพทย์ทางเลือก (DTAM) / อย.',
        standardName: 'Thai GACP (ประกาศกรมการแพทย์แผนไทยฯ ตามแนว WHO GACP)',
        whoGacpAligned: true,
        certificationRequired: true,
        keyRequirements: 'ตรวจเอกสาร + ตรวจประเมิน ณ แปลง, ระบบตรวจสอบย้อนกลับ, พ.ร.บ.ผลิตภัณฑ์สมุนไพร พ.ศ. 2562',
        gapVsThai: 'เป็นมาตรฐานอ้างอิง (baseline: มาตรฐานที่ระบบนี้ประเมินให้)',
        opportunity: 'ตลาดในประเทศ: วัตถุดิบป้อนอุตสาหกรรมยาสมุนไพร/สปา; กัญชา-กระท่อมมีกรอบกฎหมายเฉพาะ',
    },
    {
        countryCode: 'VN',
        country: 'Vietnam',
        countryTH: 'เวียดนาม',
        regulator: 'Ministry of Health — Drug Administration of Vietnam (DAV)',
        standardName: 'GACP-WHO (Circular กระทรวงสาธารณสุขอ้าง WHO GACP โดยตรง)',
        whoGacpAligned: true,
        certificationRequired: true,
        keyRequirements: 'แหล่งปลูกสมุนไพรที่ใช้ผลิตยาแผนโบราณต้องผ่าน GACP-WHO; เอกสารแหล่งกำเนิดเข้มงวด',
        gapVsThai: 'ใกล้เคียง Thai GACP (อิง WHO เหมือนกัน) ต้องมีเอกสารแปล/รับรองแหล่งกำเนิด (CO) เพิ่ม',
        opportunity: 'ตลาดยาแผนโบราณใหญ่ นำเข้าวัตถุดิบมาก ขิง/ขมิ้นชันไทยแข่งขันได้ที่คุณภาพ',
    },
    {
        countryCode: 'ID',
        country: 'Indonesia',
        countryTH: 'อินโดนีเซีย',
        regulator: 'BPOM (Badan POM) / Ministry of Agriculture',
        standardName: 'CPOTB (GMP ยาแผนโบราณ Jamu) + GAP พืชสมุนไพร',
        whoGacpAligned: true,
        certificationRequired: true,
        keyRequirements: 'วัตถุดิบเข้าโรงงาน Jamu ต้องมีหลักฐานคุณภาพ/สารปนเปื้อน; ทะเบียนผลิตภัณฑ์ BPOM เข้มงวด',
        gapVsThai: 'ต้องเพิ่มผลวิเคราะห์แล็บต่อรุ่น (heavy metals/microbial) + เอกสารฮาลาลสำหรับหลายหมวดสินค้า',
        opportunity: 'อุตสาหกรรม Jamu ขนาดใหญ่มาก ขมิ้นชัน/ขิง/ไพลมีดีมานด์สูง; ประชากรมุสลิมใหญ่สุดในโลก = โอกาสสมุนไพรฮาลาล',
    },
    {
        countryCode: 'MY',
        country: 'Malaysia',
        countryTH: 'มาเลเซีย',
        regulator: 'NPRA (National Pharmaceutical Regulatory Agency) / DOA Malaysia',
        standardName: 'MyGAP (Malaysian Good Agricultural Practices) + GMP ยาแผนโบราณ',
        whoGacpAligned: true,
        certificationRequired: true,
        keyRequirements: 'ผลิตภัณฑ์สมุนไพรจดทะเบียนกับ NPRA; วัตถุดิบต้องสอบย้อนแหล่งปลูกได้; ฮาลาลสำคัญเชิงพาณิชย์',
        gapVsThai: 'ต้องเพิ่มใบรับรองฮาลาล (JAKIM) สำหรับตลาดหลัก + เอกสารสอบย้อนกลับต่อ shipment',
        opportunity: 'ตลาดพรีเมียมสมุนไพรฮาลาล; ระบบ trace ของแพลตฟอร์มตอบโจทย์ข้อกำหนดสอบย้อนกลับโดยตรง',
    },
    {
        countryCode: 'PH',
        country: 'Philippines',
        countryTH: 'ฟิลิปปินส์',
        regulator: 'Philippine FDA / Department of Agriculture',
        standardName: 'PhilGAP + FDA registration (Traditional/Herbal products)',
        whoGacpAligned: true,
        certificationRequired: false,
        keyRequirements: 'ผลิตภัณฑ์สมุนไพรขึ้นทะเบียน FDA; GAP สมัครใจแต่ผู้ซื้ออุตสาหกรรมเรียกหา',
        gapVsThai: 'เกณฑ์ต่ำกว่าไทยในภาคเพาะปลูก Thai GACP เพียงพอ; เพิ่มเอกสารขึ้นทะเบียนผลิตภัณฑ์ปลายทาง',
        opportunity: 'นำเข้าวัตถุดิบสมุนไพรแปรรูปเพิ่มขึ้น; ขิง/ขมิ้นชันไทยมีภาพลักษณ์คุณภาพเหนือกว่า',
    },
    {
        countryCode: 'SG',
        country: 'Singapore',
        countryTH: 'สิงคโปร์',
        regulator: 'HSA (Health Sciences Authority)',
        standardName: 'ไม่มี GACP ภายในประเทศ (พื้นที่เกษตรจำกัด) คุมที่ผลิตภัณฑ์ตามกรอบ ASEAN TMHS',
        whoGacpAligned: true,
        certificationRequired: false,
        keyRequirements: 'มาตรฐานความปลอดภัยผลิตภัณฑ์สูงสุดในภูมิภาค: โลหะหนัก/จุลินทรีย์/สารต้องห้ามตาม ASEAN TMHS annexes',
        gapVsThai: 'ต้องมีผลแล็บครบทุกรุ่น + ฉลาก/claim ตามกรอบ TMHS เอกสารคุณภาพเข้มกว่าใบรับรองแปลง',
        opportunity: 'ตลาด re-export มูลค่าสูง; ผ่านเกณฑ์สิงคโปร์ = ใบเบิกทางสู่ตลาดพัฒนาแล้วอื่น',
    },
    {
        countryCode: 'MM',
        country: 'Myanmar',
        countryTH: 'เมียนมา',
        regulator: 'FDA Myanmar / Department of Traditional Medicine',
        standardName: 'ระบบยาแผนโบราณของรัฐ · ยังไม่มี GACP แห่งชาติที่บังคับใช้ทั่วไป',
        whoGacpAligned: false,
        certificationRequired: false,
        keyRequirements: 'ทะเบียนยาแผนโบราณ; การค้าชายแดนใช้เอกสารแหล่งกำเนิดเป็นหลัก',
        gapVsThai: 'Thai GACP สูงกว่าเกณฑ์ท้องถิ่น ไม่มีช่องว่างเชิงมาตรฐาน แต่มีความเสี่ยงด้านโลจิสติกส์/การชำระเงิน',
        opportunity: 'แหล่งวัตถุดิบต้นน้ำ (นำเข้ามาแปรรูปในไทย) มากกว่าตลาดปลายทาง',
    },
    {
        countryCode: 'KH',
        country: 'Cambodia',
        countryTH: 'กัมพูชา',
        regulator: 'Ministry of Health — Department of Drugs and Food',
        standardName: 'ทะเบียนยาแผนโบราณ · ยังไม่มี GACP แห่งชาติ',
        whoGacpAligned: false,
        certificationRequired: false,
        keyRequirements: 'ขึ้นทะเบียนผลิตภัณฑ์; ตลาดพึ่งพาการนำเข้าจากไทย/เวียดนามสูง',
        gapVsThai: 'Thai GACP เกินเกณฑ์ท้องถิ่น ใช้ใบรับรองไทยเป็นจุดขายได้เลย',
        opportunity: 'ตลาดชายแดนโตต่อเนื่อง; สินค้าสมุนไพรไทยมีภาพลักษณ์พรีเมียม',
    },
    {
        countryCode: 'LA',
        country: 'Laos',
        countryTH: 'ลาว',
        regulator: 'Ministry of Health — Food and Drug Department',
        standardName: 'ทะเบียนยาแผนโบราณ · ยังไม่มี GACP แห่งชาติ',
        whoGacpAligned: false,
        certificationRequired: false,
        keyRequirements: 'ทะเบียนผลิตภัณฑ์; การค้าสมุนไพรข้ามแดนกับไทยเป็นช่องทางหลัก',
        gapVsThai: 'Thai GACP เกินเกณฑ์ท้องถิ่น เน้นเอกสารแหล่งกำเนิดและฉลากภาษาลาว',
        opportunity: 'แหล่งวัตถุดิบป่า/ปลูกต้นน้ำ + ตลาดชายแดน; โมเดล contract farming ที่สอบย้อนกลับได้',
    },
    {
        countryCode: 'BN',
        country: 'Brunei',
        countryTH: 'บรูไน',
        regulator: 'Ministry of Health — Department of Pharmaceutical Services',
        standardName: 'ควบคุมที่ผลิตภัณฑ์ตามกรอบ ASEAN TMHS ไม่มี GACP ภายในประเทศ',
        whoGacpAligned: true,
        certificationRequired: false,
        keyRequirements: 'ทะเบียนผลิตภัณฑ์ + ฮาลาลเป็นข้อกำหนดเชิงพาณิชย์หลัก',
        gapVsThai: 'เพิ่มใบรับรองฮาลาล + เอกสารคุณภาพตาม TMHS annexes',
        opportunity: 'ตลาดเล็กแต่กำลังซื้อสูง; สินค้าสมุนไพรฮาลาลพรีเมียม',
    },
];

module.exports = { ASEAN_COMPARISON };
