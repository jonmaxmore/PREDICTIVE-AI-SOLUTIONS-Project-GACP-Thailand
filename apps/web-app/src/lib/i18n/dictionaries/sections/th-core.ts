import { SERVICE_NAME } from '@/lib/pricing/fee-services';
import { NOT_CHARGED_TH, PAYEE_TH } from '@/constants/service-facts';
import { SUPPORT_EMAIL } from '@/constants/contact-emails';

export const thCore = {
common: {
        ministryName: "กรมการแพทย์แผนไทยและการแพทย์ทางเลือก",
        ministryAddress: "88/23 หมู่ 4 ตำบลตลาดขวัญ อำเภอเมืองนนทบุรี จังหวัดนนทบุรี 11000",
        skipToContent: "ข้ามไปยังเนื้อหาหลัก",
        mainLandmark: "เนื้อหาหลัก",
        loading: "กำลังโหลด...",
        error: "เกิดข้อผิดพลาด",
        save: "บันทึก",
        cancel: "ยกเลิก",
        edit: "แก้ไข",
        delete: "ลบ",
        back: "กลับ",
        confirm: "ยืนยัน",
        leave: "ออกจากหน้า",
        success: "สำเร็จ",
        retry: "ลองอีกครั้ง",
        close: "ปิด",
        unsavedChanges: {
            title: "ออกจากหน้านี้โดยไม่บันทึก?",
            description: "ข้อมูลที่แก้ไขยังไม่ถูกบันทึก หากออกตอนนี้ ข้อมูลที่ทำไว้จะหายไป",
        },
        viewAll: "ดูทั้งหมด",
        startNow: "เริ่มต้นตอนนี้",
        newApplication: "ยื่นคำขอ",
        verified: "ยืนยันแล้ว",
        pendingVerification: "รอยืนยัน",
        logout: "ออกจากระบบ",
        certificationSystem: "ระบบรับรองมาตรฐาน",
        all: "ทั้งหมด",
        inProgress: "กำลังดำเนินการ",
        draft: "แบบร่าง",
        submitDocument: "ยื่นเอกสารขอรับรอง",
        submitDate: "ยื่นเมื่อ",
        viewDetails: "ดูรายละเอียด",
        startFirstApp: "เริ่มสร้างคำขอแรกของคุณ",
        startFirstAppDesc: "ระบบจะช่วยแนะนำคุณทุกขั้นตอนในการขอรับรองมาตรฐาน GACP",
        startApplication: "เริ่มยื่นคำขอ",
        herb: "สมุนไพร",
        Applicant: "เกษตรกร",
        menuShortcuts: "เมนูลัด",
        processingStatus: "สถานะดำเนินการ",
        fetchError: {
            title: "ไม่สามารถโหลดข้อมูลได้",
            hint: "ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ในขณะนี้ กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตและลองอีกครั้ง",
            retry: "ลองอีกครั้ง"
        },
        help: "ช่วยเหลือ",
        /* Y1-FIX-A — language toggle keys (mirror of en-core; see the note
           there on why the announcement stays in the page's own language). */
        languageToggle: "EN",
        languageToggleAria: "สลับภาษาเป็นภาษาอังกฤษ",
        /* Y1-FIX-A — cross-cutting action panel labels. */
        actionPanel: {
            actionRequired: "ต้องดำเนินการ",
            pendingDecision: "รอผลการพิจารณา"
        },
        /* Y1-FIX-A — universal timeline labels. */
        timeline: {
            statusUpdated: "อัปเดตสถานะ",
            by: "โดย",
            system: "ระบบ",
            createdAt: "สร้างเมื่อ",
            updatedAt: "อัปเดตล่าสุด"
        }
    },
quickActions: {
        registerDesc: "ยื่นเอกสารขอรับรอง",
        trackingDesc: "ตรวจสอบขั้นตอน",
        profileDesc: "แก้ไขประวัติ",
        settingsDesc: "จัดการบัญชี"
    },
trackingPage: {
        subtitle: "ตรวจสอบความคืบหน้าของคำขอใบรับรอง GACP",
        plantingCycles: "รอบการปลูก",
        plantingCyclesDesc: "จัดการรอบปลูก",
        lots: "ล็อต",
        lotsDesc: "ล็อตสินค้า",
        cultivationLog: "บันทึกการดูแล",
        cultivationLogDesc: "บันทึกการเพาะปลูก",
        applicationNo: "เลขที่ใบสมัคร",
        progress: "ความคืบหน้า",
        noTracking: "ไม่มีรายการติดตาม",
        noTrackingDesc: "คุณยังไม่ได้ยื่นคำขอรับรองมาตรฐาน GACP",
        createNew: "สร้างคำขอใหม่"
    },
settingsPage: {
        notifications: "รับการแจ้งเตือน",
        notificationValue: "เปิด",
        edit: "แก้ไข"
    },
loginPage: {
        heroTitle: "ยกระดับมาตรฐานสมุนไพรไทย สู่สากล",
        heroSubtitle: "ระบบรับรองมาตรฐานการผลิตพืชสมุนไพร (GACP)\nระบบรับรองมาตรฐาน GACP สมุนไพร",
        accountLocked: "บัญชีถูกระงับชั่วคราว",
        errorOccurred: "เกิดข้อผิดพลาด"
    },
tracePage: {
        notFound: "ไม่พบข้อมูลผลิตภัณฑ์",
        connectionError: "เกิดข้อผิดพลาดในการเชื่อมต่อ",
        verifying: "กำลังตรวจสอบความถูกต้อง..."
    },
dashboard: {
        greeting: {
            morning: "สวัสดีตอนเช้า",
            afternoon: "สวัสดีตอนบ่าย",
            evening: "สวัสดีตอนเย็น",
        },
        verification: {
            warningTitle: "กรุณายืนยันตัวตน",
            warningMsg: "คุณยังไม่ได้ยืนยันตัวตน หรืออยู่ระหว่างการตรวจสอบ\nกรุณาดำเนินการให้เสร็จสิ้นเพื่อเริ่มยื่นคำขอใบรับรอง",
            button: "ยืนยันตัวตนทันที",
            statusPending: "สถานะ: รอการยืนยันตัวตน",
        },
        hero: {
            newApp: "ยื่นคำขอใหม่",
            verifyToStart: "ยืนยันตัวตนเพื่อเริ่มใช้งาน",
        },
        stats: {
            total: "คำขอทั้งหมด",
            active: "กำลังดำเนินการ",
            pendingAudit: "รอตรวจแปลง",
            certified: "ใบรับรอง",
            docReview: "กำลังตรวจเอกสาร",
            inProgress: "กำลังดำเนินการ",
        },
        status: {
            DRAFT: "ร่างคำขอ",
            SUBMITTED: "รอตรวจเอกสาร",
            PENDING_DOC_FEE: "รอชำระค่าบริการ",
            PAID_PHASE_1: "ชำระเงินแล้ว (งวด 1)",
            PAYMENT_2_PENDING: "รอชำระค่าบริการ",
            PENDING_AUDIT_FEE: "รอชำระค่าบริการ",
            PAID_PHASE_2: "ชำระเงินแล้ว (งวด 2)",
            REVISION_REQUESTED: "ต้องแก้ไขเอกสาร",
            DOC_APPROVED: "เอกสารผ่านการตรวจสอบ",
            AUDIT_CONFIRMED: "รอตรวจประเมิน",
            APPROVED: "ได้รับการรับรอง",
        },
        welcome: "สวัสดี",
        subtitle: "จัดการแปลงปลูกและใบรับรองของคุณได้ที่นี่",
        actions: {
            newApplication: "ยื่นคำขอใหม่",
            register: "ขึ้นทะเบียนแปลง",
            tracking: "ติดตามสถานะ",
            profile: "ข้อมูลส่วนตัว",
            settings: "ตั้งค่าระบบ",
            viewAll: "ดูทั้งหมด",
            startNow: "เริ่มขอการรับรองเลย!"
        },
        sections: {
            recent: "รายการล่าสุด",
            certificates: "ใบรับรองของฉัน",
            quickMenu: "เมนูด่วน",
            noCert: "ยังไม่มีใบรับรอง",
            noApp: "ยังไม่มีคำขอใบรับรอง",
            startApp: "เริ่มต้นยื่นคำขอแรกของคุณได้เลย",
            status: "สถานะคำขอ",
            todo: "สิ่งที่ต้องทำ",
        },
        menus: {
            manual: "คู่มือการใช้งาน",
            manualDesc: "สำหรับเกษตรกร",
            report: "แจ้งปัญหา",
            reportDesc: "ติดต่อเจ้าหน้าที่",
        },
        alerts: {
            auditFeeTitle: `แจ้งชำระ${SERVICE_NAME.PHASE_2}`,
            auditFeeDesc: "คำขอของคุณผ่านการตรวจสอบเอกสารแล้ว กรุณาชำระค่าบริการเพื่อดำเนินการนัดหมายผู้ตรวจประเมิน",
            auditFeeButton: "ชำระเงินทันที",
            auditApptTitle: "มีนัดหมายตรวจประเมิน",
            date: "วันที่",
            time: "เวลา",
            modeOnline: "รูปแบบ: ตรวจออนไลน์",
            modeOnsite: "รูปแบบ: ลงพื้นที่",
            location: "สถานที่",
            meetButton: "เข้าห้องประชุมออนไลน์",
            paymentTitle: "แจ้งเตือนการชำระเงิน",
            paymentDesc: "กรุณาดำเนินการชำระค่าบริการเพื่อดำเนินการต่อ",
            paymentButton: "ชำระเงิน",
        },
        appCard: {
            title: "คำขอความจำนงรับรอง GACP",
            lastInfo: "คำขอใบรับรอง GACP",
            continue: "ดำเนินการต่อ",
            lastUpdate: "อัปเดตล่าสุด"
        },
        empty: {
            title: "ยังไม่มีรายการคำขอ",
            desc: "เริ่มต้นยื่นคำขอรับรองมาตรฐาน GACP เพื่อยกระดับฟาร์มของคุณ"
        },
        buttons: {
            download: "ดาวน์โหลดเอกสาร"
        },
        social: {
            placeholder: "เกิดอะไรขึ้นในฟาร์มของคุณ?",
            post: "โพสต์",
            trends: "เทรนด์สำหรับคุณ",
            welcomeTitle: "ยินดีต้อนรับสู่ GACP!",
            welcomeDesc: "เริ่มต้นเส้นทางสู่มาตรฐานเกษตรปลอดภัย สร้างคำขอใบรับรองแรกของคุณได้เลย",
            welcomeBtn: "ลุยเลย!",
            newPost: "สร้างโพสต์ใหม่"
        },
        nav: {
            home: "หน้าหลัก",
            notifications: "การแจ้งเตือน",
            profile: "โปรไฟล์"
        }
    },
sidebar: {
        dashboard: "หน้าหลัก",
        applications: "รายการคำขอ",
        establishments: "แปลงปลูก",
        planting: "รอบการปลูก",
        certificates: "ใบรับรอง",
        tracking: "ติดตามสถานะ",
        payments: "ประวัติการชำระเงิน",
        notifications: "แจ้งเตือน",
        profile: "ข้อมูลส่วนตัว",
        settings: "ตั้งค่าระบบ",
        logout: "ออกจากระบบ"
    },
tracking: {
        title: "ติดตามสถานะคำขอ",
        subtitle: "ตรวจสอบสถานะการยื่นคำขอใบรับรอง GACP ล่าสุดของคุณ",
        searchPlaceholder: "ค้นหาด้วยเลขที่คำขอ...",
        steps: {
            step1: "ยื่นคำขอ",
            step2: "ชำระงวด 1",
            step3: "ตรวจเอกสาร",
            step4: "ชำระงวด 2",
            step5: "ตรวจสถานที่",
            step6: "รับรอง"
        },
        status: {
            title: "สถานะปัจจุบัน",
            currentStep: "ขั้นตอนปัจจุบัน",
            lastUpdate: "อัปเดตล่าสุด",
            viewDetails: "ดูรายละเอียด"
        },
        empty: {
            title: "ไม่พบข้อมูลคำขอ",
            subtitle: "คุณยังไม่ได้ยื่นคำขอใบรับรอง เริ่มต้นได้เลยที่เมนู 'ยื่นคำขอใหม่'"
        }
    },
payment: {
        title: "ประวัติการชำระเงิน",
        subtitle: "รายการใบแจ้งหนี้และประวัติการชำระเงินทั้งหมดของคุณ",
        tabs: {
            all: "ทั้งหมด",
            pending: "รอชำระเงิน",
            paid: "ชำระแล้ว"
        },
        table: {
            date: "วันที่เอกสาร",
            docNo: "เลขที่เอกสาร",
            type: "ประเภท",
            amount: "จำนวนเงิน (บาท)",
            status: "สถานะ",
            action: "ดำเนินการ"
        },
        stats: {
            pending: "ยอดที่ต้องชำระ",
            paid: "ชำระแล้ว"
        },
        types: {
            quotation: "ใบเสนอราคา",
            invoice: "ใบแจ้งหนี้",
            receipt: "ใบเสร็จรับเงิน"
        },
        actions: {
            pay: "ชำระเงิน",
            download: "ดาวน์โหลด",
            view: "ดูรายละเอียด"
        }
    },
settings: {
        title: "ตั้งค่าระบบ",
        subtitle: "การกำหนดค่าระบบและการตั้งค่าส่วนตัว",
        general: "ทั่วไป",
        language: "ภาษา",
        security: "ความปลอดภัย",
        notifications: "การแจ้งเตือน",
        theme: "ธีม",
        darkMode: "โหมดมืด",
        password: "รหัสผ่าน",
        changePassword: "เปลี่ยนรหัสผ่าน",
        display: "การแสดงผล",
        currentPassword: "รหัสผ่านปัจจุบัน",
        newPassword: "รหัสผ่านใหม่",
        confirmNewPassword: "ยืนยันรหัสผ่านใหม่",
        passwordPlaceholder: "กรอกรหัสผ่านปัจจุบัน",
        newPasswordPlaceholder: "กรอกรหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)",
        confirmPasswordPlaceholder: "กรอกรหัสผ่านใหม่อีกครั้ง",
        changePasswordSuccess: "เปลี่ยนรหัสผ่านสำเร็จ!",
        changePasswordFail: "เปลี่ยนรหัสผ่านไม่สำเร็จ",
        fillAllFields: "กรุณากรอกข้อมูลให้ครบถ้วน",
        passwordTooShort: "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร",
        passwordsDoNotMatch: "รหัสผ่านใหม่ไม่ตรงกัน",
        genericError: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"
    },
eyebrow: {
        applicantDashboard: "หน้าหลัก ผู้ขอรับรอง",
        applicantApplications: "ผู้ขอรับรอง · คำขอ",
        applicantNotifications: "ผู้ขอรับรอง · การแจ้งเตือน",
        staffNotifications: "เจ้าหน้าที่ · การแจ้งเตือน",
        applicantCertificates: "ผู้ขอรับรอง · ใบรับรอง",
        applicantSettings: "ผู้ขอรับรอง · ตั้งค่า",
        applicantTracking: "ผู้ขอรับรอง · ติดตามผลผลิต"
    },
time: {
        minutesAgo: "{n} นาทีที่แล้ว",
        hoursAgo: "{n} ชั่วโมงที่แล้ว",
        daysAgo: "{n} วันที่แล้ว"
    },
filters: {
        actionRequired: "ต้องดำเนินการ",
        inProgress: "กำลังดำเนินการ",
        completed: "สำเร็จ",
        unreadOnly: "ยังไม่อ่าน"
    },
deadline: {
        overdueBy: "เลยกำหนด {n} วัน",
        timeLeftHours: "เหลือเวลา {n} ชม.",
        timeLeftDays: "เหลือเวลา {n} วัน",
        carUrgent: "กรุณาส่งเอกสารแก้ไข (CAR) ด่วน",
        revisionUrgent: "กรุณาแก้ไขด่วน",
        beforeCarDeadline: "ก่อนหมดเวลาส่งเอกสารแก้ไข (CAR)",
        beforeRevisionDeadline: "ก่อนหมดเวลาแก้ไข"
    },
notifications: {
        title: "การแจ้งเตือน",
        subtitle: "ติดตามสถานะคำขอและการดำเนินงานล่าสุด",
        markAllRead: "ทำเครื่องหมายว่าอ่านแล้ว",
        new: "ใหม่",
        unread: "ยังไม่อ่าน",
        noUnread: "ไม่มีรายการใหม่!",
        noUnreadDesc: "ตอนนี้คุณอ่านการแจ้งเตือนทั้งหมดแล้ว เยี่ยมมาก",
        empty: "ไม่มีการแจ้งเตือน",
        emptyDesc: "ยังไม่มีการแจ้งเตือนในระบบ กรุณากลับมาตรวจสอบภายหลัง",
        viewDetails: "ดูรายละเอียด",
        officialLetter: "หนังสือราชการ",
        officialLetterKept: "เก็บถาวร · ลบไม่ได้",
        // N6 — {date} เติมโดยกล่องจดหมาย · ใบที่ยังไม่เปิดจะไม่แสดงบรรทัดนี้เลย
        letterOpenedAt: "เปิดอ่านเมื่อ {date}",
        dueBy: "ภายในวันที่ {date}",
        overdue: "เลยกำหนดแล้ว",
        keptThirtyDays: "อ่านแล้วเก็บไว้ 30 วัน",
        keptUntilRead: "เก็บไว้จนกว่าจะอ่าน",
        retentionNote: "การแจ้งเตือนทั่วไปจะถูกลบ 30 วันหลังจากที่คุณอ่าน · หนังสือราชการเก็บไว้ถาวร"
    },
certificates: {
        title: "ใบรับรอง GACP",
        subtitle: "ใบรับรองมาตรฐานรายฟาร์ม (1 ฟาร์ม = 1 ใบรับรอง)",
        active: "ใช้งานได้",
        expiring: "ใกล้หมดอายุ",
        expired: "หมดอายุ",
        notFoundTitle: "ยังไม่พบใบรับรอง",
        notFoundHint: "ยื่นคำขอใหม่เพื่อรับการตรวจประเมินมาตรฐาน GACP",
        loadFailTitle: "ไม่สามารถโหลดรายการใบรับรองได้",
        loadFailHint: "ไม่สามารถโหลดรายการใบรับรองได้",
        connectionError: "ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ กรุณาลองใหม่อีกครั้ง",
        retry: "ลองอีกครั้ง",
        newApplication: "ยื่นคำขอใหม่",
        viewCert: "ดูใบรับรอง",
        download: "ดาวน์โหลด",
        renew: "ยื่นต่ออายุ",
        validityProgress: "อายุใบรับรอง ({n} ปี)",
        validityProgressUnknown: "อายุใบรับรอง",
        daysRemaining: "เหลือ {n} วัน",
        expiredAlready: "หมดอายุแล้ว",
        issuedAt: "ออกเมื่อ",
        expiresAt: "หมดอายุ",
        auditor: "ผู้ตรวจ",
        lastAudit: "ตรวจล่าสุด",
        score: "คะแนน",
        area: "พื้นที่",
        closeWindow: "ปิดหน้าต่าง",
        qrAltText: "คิวอาร์โค้ดของใบรับรอง GACP"
    },
applicationsList: {
        title: "คำขอรับรอง GACP",
        subtitle: "ติดตามสถานะ ดำเนินการ และจัดการคำขอรับรองมาตรฐาน GACP ทั้งหมดของคุณ",
        metricTotal: "คำขอทั้งหมด",
        metricActionRequired: "ต้องดำเนินการ",
        metricInProgress: "กำลังดำเนินการ",
        metricCompleted: "สำเร็จ",
        newApplicationBtn: "+ ยื่นคำขอใหม่",
        listHeading: "รายการคำขอ",
        itemCount: "รายการ",
        emptyTitle: "ไม่พบรายการคำขอตามตัวกรองนี้",
        emptyHint: "ลองเปลี่ยนสถานะ หรือคำค้นหา แล้วตรวจสอบอีกครั้ง หรือกด ‘สร้างคำขอใหม่’ ด้านบนเพื่อเริ่มต้น",
        continueDraft: "ดำเนินการต่อ",
        deleteDraft: "ลบร่างคำขอนี้",
        deleteDraftTitle: "ลบร่างคำขอนี้?",
        deleteDraftDesc: "ร่างคำขอจะถูกลบถาวร การลบไม่สามารถย้อนกลับได้",
        deleteDraftConfirm: "ลบร่างคำขอ",
        stepLabel: "ขั้นตอนที่ {current}/{total}",
        loadError: "ไม่สามารถโหลดรายการคำขอได้",
        loadErrorRetry: "เกิดข้อผิดพลาดในการโหลดรายการคำขอ กรุณาลองใหม่อีกครั้ง",
        deleteDraftError: "ไม่สามารถลบร่างคำขอได้ กรุณาลองใหม่",
        deleteDraftErrorGeneric: "เกิดข้อผิดพลาดในการลบร่างคำขอ"
    },
renewalAdvisory: {
        /* Operator decision 6 (2026-09-17), audit UXUI-X2: the body sent the
           applicant to DTAM to pay. The renewal is paid to the platform company
           (W14), only through the system, which cannot take it yet
           (constants/service-facts.ts). The "cannot pay yet", "not charged",
           payee and channel facts are read from service-facts, not restated.
           PromptPay QR step (2026-09-27): the checkout page can now show the QR,
           so "the payment page cannot show the QR" stopped being the reason.
           The reason that still holds is the renewal wizard's own: its payment
           step is not connected to the checkout page (RENEWAL_PAYMENT_WIRED is
           false in app/health/applications/renewal/client-view.tsx). */
        title: `ขณะนี้ยังชำระ${SERVICE_NAME.RENEWAL}ผ่านระบบไม่ได้`,
        body: `ขั้นตอนต่ออายุนี้ยังไม่เชื่อมกับหน้าชำระเงินของระบบ จึงยังชำระ${SERVICE_NAME.RENEWAL}จากขั้นตอนนี้ไม่ได้ ${NOT_CHARGED_TH} ${SERVICE_NAME.RENEWAL}ชำระให้${PAYEE_TH}ผ่านระบบเท่านั้น ไม่ได้ชำระให้กรมการแพทย์แผนไทยและการแพทย์ทางเลือกโดยตรง`,
        contactCta: "ติดต่อเจ้าหน้าที่",
        contactEmail: SUPPORT_EMAIL,
        contactFormCta: "เปิดฟอร์มติดต่อ"
    }
};

