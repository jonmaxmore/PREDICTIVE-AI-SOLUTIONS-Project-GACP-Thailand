export const thVerifier = {
verifier: {
        eyebrow: "ชั้นความเชื่อถือภาครัฐ",
        title: "พอร์ทัลตรวจสอบใบรับรอง",
        // "Revocation Transparency" / "Signature Verification" / "Trace Events"
        // used to sit untranslated in this sentence, even though the section
        // headings below already carried the formal Thai for all three.
        subtitle: "ศูนย์ตรวจสอบใบรับรอง GACP ความโปร่งใสการเพิกถอน การตรวจสอบลายเซ็นดิจิทัล และเหตุการณ์ตรวจสอบย้อนกลับ ตามสัญญาข้อมูลกลาง",

        // สามแท็บนี้ (ทะเบียน · รายการเพิกถอน · เหตุการณ์ตรวจสอบย้อนกลับ) เฝ้าด้วย partner API key
        // ที่ฝั่งเซิร์ฟเวอร์ ผู้เข้าชมทั่วไปจึงได้ 401 เสมอ · เดิมข้อความที่ขึ้นคือคำปฏิเสธภาษาอังกฤษ
        // จากเซิร์ฟเวอร์ ("Partner API key required") บนหน้าภาษาไทย — บอกความจริงตรง ๆ ดีกว่า
        partnerKeyOnly: "ส่วนนี้เปิดให้เฉพาะหน่วยงานที่เชื่อมระบบด้วยกุญแจคู่เชื่อม (partner API key) ผู้เข้าชมทั่วไปยังตรวจสอบใบรับรองและลายเซ็นดิจิทัลได้ตามปกติ",

        certificate: {
            title: "ตรวจสอบใบรับรอง",
            numberLabel: "หมายเลขใบรับรอง",
            numberPlaceholder: "เช่น CERT-2026-0001",
            submit: "ตรวจสอบใบรับรอง",
            submitting: "กำลังตรวจสอบ...",
            missingNumber: "กรุณาระบุหมายเลขใบรับรอง",
            failed: "ไม่สามารถตรวจสอบใบรับรองได้",
            unexpected: "เกิดข้อผิดพลาดระหว่างตรวจสอบใบรับรอง",
            trustStatus: "สถานะความเชื่อถือ",
            outcome: "ผลการตรวจสอบ",
            pass: "ผ่าน",
            fail: "ไม่ผ่าน",
            number: "เลขใบรับรอง",
            issuedDate: "วันออกใบรับรอง",
            expiryDate: "วันหมดอายุ",
            location: "สถานที่",
            revokedReason: "เหตุผลเพิกถอน",
        },

        registry: {
            title: "ทะเบียนความเชื่อถือและความโปร่งใสการเพิกถอน",
            loadRegistry: "โหลดทะเบียน",
            loadRevocations: "โหลดรายการเพิกถอน",
            loading: "กำลังโหลด...",
            registryHeading: "ทะเบียนความเชื่อถือ",
            // was "ยังไม่มีข้อมูล trust registry หรือยังไม่ได้โหลด"
            registryEmpty: "ยังไม่มีข้อมูลทะเบียนความเชื่อถือ หรือยังไม่ได้โหลด",
            registryFailed: "ไม่สามารถดึงข้อมูลทะเบียนความเชื่อถือได้",
            registryUnexpected: "เกิดข้อผิดพลาดระหว่างดึงข้อมูลทะเบียนความเชื่อถือ",
            revocationHeading: "รายการเพิกถอน",
            revocationEmpty: "ยังไม่มีข้อมูลการเพิกถอน หรือยังไม่ได้โหลด",
            revocationFailed: "ไม่สามารถดึงรายการเพิกถอนได้",
            revocationUnexpected: "เกิดข้อผิดพลาดระหว่างดึงรายการเพิกถอน",
            trustStatus: "สถานะความเชื่อถือ",
            farm: "ฟาร์ม",
            revokedAt: "วันที่เพิกถอน",
            reason: "เหตุผล",
        },

        signature: {
            title: "ตรวจสอบเอกสารลงลายเซ็นดิจิทัล",
            payloadLabel: "ข้อมูลนำเข้า (JSON)",
            hashLabel: "ค่าแฮชของข้อมูล (ไม่บังคับ)",
            hashPlaceholder: "sha256 hex",
            signatureLabel: "ลายเซ็นดิจิทัล",
            signaturePlaceholder: "signature hex/base64",
            publicKeyLabel: "กุญแจสาธารณะ (ไม่บังคับ)",
            publicKeyPlaceholder: "-----BEGIN PUBLIC KEY-----",
            submit: "ตรวจสอบลายเซ็นดิจิทัล",
            submitting: "กำลังตรวจสอบ...",
            missingSignature: "กรุณาระบุลายเซ็นดิจิทัล",
            failed: "ไม่สามารถตรวจสอบลายเซ็นดิจิทัลได้",
            unexpected: "เกิดข้อผิดพลาดระหว่างตรวจสอบลายเซ็นดิจิทัล",
            outcome: "ผลตรวจลายเซ็น",
            pass: "ผ่าน",
            fail: "ไม่ผ่าน",
            algorithm: "อัลกอริทึม",
            hash: "ค่าแฮช",
        },

        trace: {
            title: "เหตุการณ์ตรวจสอบย้อนกลับ",
            entityTypeLabel: "ประเภทข้อมูล",
            entityIdLabel: "รหัสข้อมูล",
            entityIdPlaceholder: "เช่น certificateNumber / cycleId / lotNumber",
            submit: "ดึงเหตุการณ์ตรวจสอบย้อนกลับ",
            submitting: "กำลังโหลด...",
            missingEntityId: "กรุณาระบุรหัสข้อมูล",
            failed: "ไม่สามารถดึงเหตุการณ์ตรวจสอบย้อนกลับได้",
            unexpected: "เกิดข้อผิดพลาดระหว่างดึงเหตุการณ์ตรวจสอบย้อนกลับ",
            empty: "ไม่พบเหตุการณ์สำหรับข้อมูลนี้",
            actor: "ผู้ดำเนินการ",
        },
    },
};
