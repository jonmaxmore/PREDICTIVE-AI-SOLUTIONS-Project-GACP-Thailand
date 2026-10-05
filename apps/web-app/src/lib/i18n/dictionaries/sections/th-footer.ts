export const thFooter = {
footer: {
        landmarkLabel: "ข้อมูลกระทรวงและลิงก์ส่วนล่าง",
        addressLabel: "ที่อยู่:",
        phonePrefix: "โทร",
        phoneAria: "โทรศัพท์ {phone}",
        emailAria: "ส่งอีเมลถึง {email}",

        linksLandmarkLabel: "ลิงก์ส่วนล่าง",
        linksHeading: "เกี่ยวกับและความช่วยเหลือ",
        links: {
            about: "เกี่ยวกับ GACP",
            accessibility: "นโยบายการเข้าถึงเว็บไซต์",
            privacy: "นโยบายความเป็นส่วนตัว",
            terms: "ข้อกำหนดการใช้งาน",
            sitemap: "แผนผังเว็บไซต์",
            help: "วิธีใช้งานระบบ",
        },

        systemHeading: "ระบบและเวอร์ชัน",
        lastUpdated: "ปรับปรุงล่าสุด",
        buildDateFallback: "ไม่ทราบรุ่นบิลด์",
        version: "เวอร์ชัน",
        ministrySite: "เว็บไซต์กรม",
        ministrySiteAria: "เว็บไซต์กรมการแพทย์แผนไทยและการแพทย์ทางเลือก dtam.moph.go.th (เปิดในแท็บใหม่)",

        /* Operator decision 6 (2026-09-17), audit UXUI-02: these two lines said
           "ระบบนี้รับรองโดย{ministry}" and "เป็นเว็บไซต์ของรัฐบาลไทย ใช้งานฟรี
           ไม่มีค่าใช้จ่ายแอบแฝง". No record shows an authorisation, and the
           service is billed. What is on record: the platform company runs and
           bills it (payment-terms v1.2 §1), the certificate is the
           department's (Terms §1-§2, the certificate PDF). Wording kept in step
           with constants/service-facts.ts (PAYEE_TH, CERTIFICATE_ISSUER_TH). */
        operatedBy: "ระบบนี้เป็นบริการของบริษัทผู้ให้บริการแพลตฟอร์ม ใบรับรองออกโดย{ministry}",
        feesNotice: "บริการนี้มีค่าบริการ",
        feesLink: "ดูค่าบริการทั้งหมด",

        copyright: "© {year} มหาวิทยาลัยราชภัฏสวนสุนันทา สงวนลิขสิทธิ์",
        accessibilityProblem: "หากพบปัญหาในการเข้าถึงเว็บไซต์ โปรดติดต่อ",
        accessibilityProblemAria: "แจ้งปัญหาการเข้าถึงผ่านอีเมล {email}",
    },
};
