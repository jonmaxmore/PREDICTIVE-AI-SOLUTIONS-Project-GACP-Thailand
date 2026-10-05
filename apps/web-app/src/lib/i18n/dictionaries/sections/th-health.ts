import { SERVICE_NAME, SERVICE_NOUN } from '@/lib/pricing/fee-services';
import { NOT_CHARGED_TH, PAYMENT_CHANNEL_TH } from '@/constants/service-facts';

/**
 * Y1-FIX-B — HEALTH-side i18n dictionary (TH).
 *
 * Thai counterpart of `en-health.ts`. Both files must keep IDENTICAL
 * key shapes so the dictionary-parity test (W3-C) passes.
 *
 * Wired into `th.ts` as `...thHealth` after `...thPROVIDER`.
 */
export const thHealth = {
    health: {
        applicationDetail: {
            eyebrow: "ผู้ขอรับรอง · คำขอ",
            backToList: "กลับไปรายการคำขอ",
            errorTitle: "เกิดข้อผิดพลาด",
            errorBody: "ไม่พบข้อมูลคำขอ",
            errorMissingId: "ไม่พบรหัสคำขอ",
            errorLoadFailed: "เกิดข้อผิดพลาดในการโหลดข้อมูลคำขอ",
            submittedOn: "ยื่นเมื่อ",
            applicationCardTitle: "ข้อมูลคำขอ",
            paymentStatusTitle: "สถานะการชำระเงิน",
            officerCommentsTitle: "ความคิดเห็นเจ้าหน้าที่",
            officerCommentsEmpty: "ยังไม่มีความคิดเห็นจากเจ้าหน้าที่",
            timelineTitle: "ลำดับเหตุการณ์",
            timelineEmpty: "ยังไม่มีประวัติการเปลี่ยนสถานะ",
            timelineBy: "โดย:",
            stepCounter: "ขั้นตอนที่ {n} จาก {total}",
            actionDeadline: "กำหนดส่ง: {date} ({days} วันทำการ)",
            postCertTitle: "ขั้นตอนถัดไปหลังได้ใบรับรอง",
            downloadCert: "ดาวน์โหลดใบรับรอง",
            downloadCertDesc: "บันทึกไฟล์ PDF ใบรับรอง GACP",
            monthlyReports: "ส่งรายงานรายเดือน",
            monthlyReportsDesc: "ภ.ท.27, ภ.ท.28 ตามเงื่อนไข",
            renewCert: "ต่ออายุใบรับรอง",
            renewCertDesc: "ก่อนหมดอายุ 90 วัน",
            previewCta: "ดูตัวอย่าง",
            paymentCta: "การชำระเงิน",
            documentsCta: "เอกสารทั้งหมด",
            viewDocumentsCta: "ดูเอกสารคำขอ",
            paymentHistoryCta: "ประวัติการชำระเงิน",
            fields: {
                applicantName: "ชื่อผู้ยื่น",
                applicantType: "ประเภทผู้ยื่น",
                plant: "พืชที่ยื่นขอ",
                plotName: "ชื่อแปลงปลูก",
                province: "จังหวัด",
                area: "พื้นที่",
                surroundingEnvironment: "สภาพแวดล้อมรอบแปลง",
                docFee: `${SERVICE_NOUN.PHASE_1}`,
                auditFee: `${SERVICE_NOUN.PHASE_2}`,
                paidOn: "ชำระเมื่อ {date}",
                awaitingPayment: "รอชำระ",
                perCultivationType: "ต่อ 1 รูปแบบการปลูก ยอดของคำขอนี้ดูได้ที่ใบเสนอราคา",
                paid: "ชำระแล้ว",
                pending: "รอดำเนินการ"
            }
        },
        timeline: {
            heading: "ความคืบหน้าจากเจ้าหน้าที่",
            inProgress: "กำลังดำเนินการ",
            done: "เสร็จแล้ว",
            startedAt: "เริ่มต้นเมื่อ",
            officerAccepted: "เจ้าหน้าที่รับงานเมื่อ",
            completedAt: "เสร็จเมื่อ",
            cancelledAt: "ยกเลิกเมื่อ",
            updated: "อัปเดต",
            footnote: "* ข้อมูลนี้แสดงสถานะการทำงานของเจ้าหน้าที่ที่ดูแลคำขอของคุณ รายชื่อผู้รับผิดชอบเป็นข้อมูลภายในหน่วยงาน",
            status: {
                pending: "รอเจ้าหน้าที่ดำเนินการ",
                in_progress: "เจ้าหน้าที่กำลังดำเนินการ",
                done: "เสร็จสิ้น",
                cancelled: "ยกเลิก",
                overdue: "ล่าช้า"
            }
        },
        car: {
            title: "ส่งเอกสารแก้ไข (CAR)",
            subtitle: "Corrective Action Request - คำขอเลขที่ {appNumber}",
            errorTitle: "เกิดข้อผิดพลาด",
            errorFetch: "ไม่สามารถโหลดข้อมูลคำขอได้ กรุณาลองใหม่อีกครั้ง",
            errorUpload: "ไม่สามารถส่งเอกสารได้ กรุณาตรวจสอบไฟล์และลองใหม่อีกครั้ง",
            retry: "ลองใหม่อีกครั้ง",
            notFoundTitle: "ไม่พบข้อมูล",
            notFoundBody: "ไม่พบคำขอที่ระบุ",
            notRequiredTitle: "ไม่ต้องดำเนินการ",
            notRequiredBody: "คำขอนี้ไม่ต้องส่งเอกสารแก้ไข (CAR)",
            requiredTitle: "ต้องแก้ไข",
            requiredBody: "คำขอของคุณต้องการการแก้ไขตามรายการด้านล่าง กรุณาแนบเอกสารหลักฐานที่แก้ไขแล้ว",
            officerNote: "หมายเหตุจากเจ้าหน้าที่: ",
            attachLabel: "รายการที่ต้องแก้ไข:",
            within: "ภายใน: {date}",
            attachFiles: "แนบเอกสารหลักฐาน",
            selectFiles: "เลือกไฟล์เอกสาร",
            supportedFiles: "รองรับไฟล์: PDF, JPG, PNG (สูงสุด 10MB ต่อไฟล์)",
            selectedFiles: "ไฟล์ที่เลือก",
            notesLabel: "หมายเหตุเพิ่มเติม (ถ้ามี)",
            notesPlaceholder: "อธิบายการแก้ไขที่ทำ...",
            cancel: "ยกเลิก",
            submit: "ส่งเอกสาร",
            footerNote: "หมายเหตุ: หลังจากส่งเอกสารแล้ว เจ้าหน้าที่จะตรวจสอบภายใน 3 วันทำการ",
            yellowTitle: "ต้องแก้ไข",
            missingFileTitle: "กรุณาแนบไฟล์",
            missingFileBody: "กรุณาแนบเอกสารหลักฐานอย่างน้อย 1 ไฟล์",
            successTitle: "สำเร็จ",
            successBody: "ส่งเอกสารแก้ไข (CAR) เรียบร้อยแล้ว รอเจ้าหน้าที่ตรวจสอบ"
        },
        renewal: {
            title: "ต่ออายุใบรับรอง GACP",
            noCertBody: "ไม่พบข้อมูลใบรับรองที่ต้องการต่ออายุ กรุณาเลือกใบรับรองจากหน้ารายการใบรับรองก่อนดำเนินการ",
            goToCertList: "ไปหน้ารายการใบรับรอง",
            /* Operator decision 6 (2026-09-17), audit UXUI-X2: this told the
               applicant to pay through DTAM. The renewal is paid to the platform
               company (W14), only through the system (constants/service-facts.ts),
               and the system cannot take it yet. */
            paymentPendingMessage: `ระบบยังรับชำระ${SERVICE_NAME.RENEWAL}ไม่ได้ในขณะนี้ ${NOT_CHARGED_TH}`,
            backConfirm: "หากกลับไปหน้าใบรับรองตอนนี้ ไฟล์ที่อัปโหลดจะหายและต้องอัปโหลดใหม่ ต้องการดำเนินการต่อหรือไม่?",
            errorCreateFailed: "ไม่สามารถสร้างคำขอต่ออายุได้ กรุณาลองใหม่อีกครั้ง",
            /* Refusals of POST /api/applications/renewals (operator ruling 2026-10-03:
               a renewal is a submission). Each names the cause and the next action. */
            errorNotOriginalFiler: "คุณไม่ใช่ผู้ยื่นคำขอเดิมของใบรับรองใบนี้ จึงต่ออายุไม่ได้ กรุณาให้ผู้ยื่นคำขอเดิมเป็นผู้ต่ออายุ",
            errorNoSubmitRight: "คุณไม่มีสิทธิ์ยื่นคำขอในนามกิจการนี้ กรุณาติดต่อเจ้าของกิจการเพื่อขอสิทธิ์ยื่นคำขอ",
            errorNoHolder: "ใบรับรองนี้ยังไม่ได้ผูกกับผู้ถือใบรับรองในระบบ จึงต่ออายุไม่ได้ กรุณาติดต่อผู้ดูแลระบบ",
            errorConnection: "เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง",
            errorNoCert: "ไม่พบข้อมูลใบรับรอง",
            /* W1-RETRY — indeterminate load-failure state (amber pattern):
               never claims the certificate is missing, only that it could
               not be loaded right now. Subline is the English pairing shown
               under the Thai copy (empty string in the EN dict — the whole
               card is already English there). */
            loadErrorTitle: "ยังโหลดข้อมูลใบรับรองไม่ได้ในขณะนี้",
            loadErrorBody: "ระบบขัดข้องชั่วคราว ยังไม่สามารถแสดงข้อมูลใบรับรองสำหรับการต่ออายุได้ กรุณาลองใหม่อีกครั้ง",
            loadErrorSubline: "Unable to load certificate data right now. Please try again.",
            upload: {
                subtitle: "อัปโหลดเอกสารประกอบการต่ออายุให้ครบถ้วนก่อนดำเนินการขั้นตอนถัดไป",
                certNumber: "เลขที่ใบรับรอง",
                location: "สถานที่",
                docsHeading: "เอกสารที่ต้องอัปโหลด",
                uploaded: "อัปโหลดแล้ว",
                uploading: "กำลังอัปโหลด...",
                selectFile: "เลือกไฟล์",
                back: "← กลับไปหน้าใบรับรอง",
                next: "ดำเนินการต่อ →"
            },
            /* W12 (มติ operator 2026-08-22) — ค่าบริการต่ออายุใบรับรองคือ 30,000 ครั้งเดียว
               และ 30,000 คือฐานก่อน VAT และก่อนค่าบริการแพลตฟอร์ม ทุกหน้าที่แสดง
               ค่าบริการต่ออายุใบรับรองต้องแสดงทั้งฐานและยอดที่ต้องชำระจริง การแสดง 30,000
               ลอย ๆ คือบั๊กที่งานนี้แก้ */
            fee: {
                // มติ operator 2026-09-07 (F-MONEY-UI-02) และย้ำ 2026-09-12:
                // "เรารวมเป็นแจ้งว่าค่าบริการ แยกตามวัตถุประสงค์การปลูก"
                //
                // baseLabel/addonsLabel เดิมกาง "ฐานค่าธรรมเนียม" กับ "ค่าบริการแพลตฟอร์ม 10%
                // และ VAT 7%" ให้เกษตรกรอ่าน ซึ่งเป็นบัญชีภายในของผู้ขาย ไม่ใช่สิ่งที่เขาซื้อ
                // หน้า checkout กับ billing ยึดกติกานี้ไปแล้ว เหลือสายต่ออายุที่ยังกางอยู่
                serviceLabel: `${SERVICE_NAME.RENEWAL} (รวมภาษีมูลค่าเพิ่มแล้ว)`,
                payableLabel: "ยอดที่ต้องชำระจริง",
                itemRenewalDetail: `${SERVICE_NAME.RENEWAL} ชำระครั้งเดียว`,
                singleChargeNote: `${SERVICE_NAME.RENEWAL}ชำระครั้งเดียว ไม่มีงวดที่ 2 และไม่มีขั้นตอนตรวจเอกสาร`,
                nextStepNote: "หลังชำระเงิน เจ้าหน้าที่จะนัดหมายลงพื้นที่ตรวจประเมินฟาร์มของคุณ"
            },
            quotation: {
                title: "ใบเสนอราคา / Quotation",
                back: "← ย้อนกลับ",
                recipient: "เรียน / To:",
                fallbackRecipient: "ผู้ขอรับบริการ",
                certNumber: "เลขที่ใบรับรอง:",
                /* F-G4-64 R23 — the screen renders the register row, so it
                   needs the four states a real lookup has. */
                loadingLabel: "กำลังโหลดใบเสนอราคาของคำขอต่ออายุ",
                lookupFailedTitle: "ตรวจสอบใบเสนอราคาไม่สำเร็จ",
                lookupFailedBody: "ระบบยังไม่ทราบสถานะใบเสนอราคาของคำขอต่ออายุนี้ กรุณากดลองอีกครั้ง หากยังไม่สำเร็จ กรุณาติดต่อเจ้าหน้าที่",
                retryCta: "ลองอีกครั้ง",
                noRowTitle: "ยังไม่มีใบเสนอราคาของคำขอต่ออายุนี้",
                noRowBody: "ระบบจะออกใบเสนอราคาให้ที่หน้ารายการชำระเงินของคำขอนี้ กรุณาเปิดหน้าดังกล่าว แล้วกดยอมรับใบเสนอราคาก่อนชำระเงิน",
                goToPaymentsCta: "ไปหน้ารายการชำระเงินของคำขอนี้",
                noRenewalTitle: "ยังไม่มีคำขอต่ออายุ",
                noRenewalBody: "ระบบจะออกใบเสนอราคาหลังจากสร้างคำขอต่ออายุแล้ว กรุณาย้อนกลับไปเริ่มคำขอต่ออายุจากหน้าใบรับรองของคุณ",
                nextCta: "ออกใบแจ้งหนี้ต่อ →"
            },
            invoice: {
                title: `ใบแจ้งหนี้${SERVICE_NAME.RENEWAL}`,
                back: "← ย้อนกลับ",
                docNumber: "เลขที่ใบแจ้งหนี้",
                docDate: "วันที่ออก",
                itemRenewal: `${SERVICE_NAME.RENEWAL}`,
                grandTotal: "ยอดรวมที่ต้องชำระ",
                statusLabel: "สถานะ",
                statusAwaiting: "รอชำระเงิน",
                statusPaid: "ชำระแล้ว",
                /* fix/fees-from-server round 1 (2026-10-03): this step used to print
                   a document the browser made up (INV-<เวลา> วันที่วันนี้ ครบกำหนด +7 วัน
                   และราคาต่อ 1 รูปแบบการปลูกเป็นยอดรวม) ตอนนี้แสดงเฉพาะเอกสารที่ระบบออกจริง */
                loadingLabel: "กำลังตรวจสอบใบแจ้งหนี้ของคำขอต่ออายุนี้",
                lookupFailedBody: "ระบบอ่านใบแจ้งหนี้ของคำขอต่ออายุนี้ไม่ได้ในขณะนี้ กรุณาลองอีกครั้ง หากยังไม่ได้ให้ติดต่อเจ้าหน้าที่",
                retryCta: "ลองอีกครั้ง",
                noInvoiceTitle: "ยังไม่มีใบแจ้งหนี้สำหรับคำขอต่ออายุนี้",
                noInvoiceBody: "ใบแจ้งหนี้จะออกเมื่อคุณยอมรับใบเสนอราคาและเริ่มชำระเงินที่หน้าการชำระเงินของคำขอนี้ ยอดที่ต้องชำระจะเท่ากับยอดในใบเสนอราคาที่คุณยอมรับ",
                quotationTotalLabel: "ยอดตามใบเสนอราคาเลขที่ {number}",
                /* Round 5: the paper is the server PDF (GET /api/invoices/:id/pdf), as on
                   the payments page; this step draws no document of its own. */
                certLabel: "ใบรับรองที่ต่ออายุ",
                downloadCta: "ดาวน์โหลดใบแจ้งหนี้",
                downloadingLabel: "กำลังเตรียมไฟล์",
                downloadFailed: "ดาวน์โหลดใบแจ้งหนี้ไม่สำเร็จ ระบบสร้างไฟล์ PDF ไม่ได้ในขณะนี้ กรุณาลองอีกครั้ง หากยังไม่สำเร็จ ติดต่อเจ้าหน้าที่การเงินพร้อมแจ้งเลขที่เอกสาร {number}",
                goToPaymentsCta: "ไปหน้าการชำระเงินของคำขอนี้",
                /* The bank-transfer rail is retired; the one rail is Stripe
                   PromptPay (constants/service-facts.ts PAYMENT_CHANNEL_TH). */
                methodTransfer: `• ${PAYMENT_CHANNEL_TH}`,
                /* Was "ดำเนินการชำระเงิน →": the step it opens cannot take the
                   payment (RENEWAL_PAYMENT_WIRED false). It shows the amount due,
                   named as the payments page names it ("ยอดรอชำระ"). */
                nextCta: "ดูยอดรอชำระ →"
            },
            payment: {
                title: "ชำระเงินค่าต่อสัญญา",
                subtitle: `ตรวจสอบยอด${SERVICE_NAME.RENEWAL}ที่ต้องชำระ`,
                back: "← ย้อนกลับ",
                /* fix/fees-from-server round 1: the figure below is the price of ONE
                   cultivation type (GET /api/pricing/fees renewalTotalPerScope); it
                   used to be labelled as the amount due whatever the application held. */
                amountLabel: `${SERVICE_NAME.RENEWAL}ต่อ 1 รูปแบบการปลูก`,
                perTypeNote: "ยอดที่ต้องชำระจริงคูณตามจำนวนรูปแบบการปลูกในคำขอ และแสดงในใบเสนอราคาและใบแจ้งหนี้ของคำขอนี้",
                caseLabel: "หมายเลขเคส:",
                /* The button below never opened a payment page: while
                   RENEWAL_PAYMENT_WIRED is false it shows paymentPendingMessage
                   (renewal/client-view.tsx). */
                helpText: `ขณะนี้ระบบยังรับชำระ${SERVICE_NAME.RENEWAL}ไม่ได้ กดปุ่มด้านล่างเพื่อตรวจสอบสถานะการชำระเงิน`,
                cta: "ตรวจสอบสถานะการชำระเงิน",
            },
            success: {
                title: "ต่อสัญญาสำเร็จ!",
                subtitle: "ขอบคุณสำหรับการต่ออายุใบรับรอง GACP",
                caseLabel: "หมายเลขเคส:",
                summaryTitle: "สรุปการต่อสัญญา",
                certNumberLabel: "ใบรับรองเลขที่",
                locationLabel: "สถานที่",
                amountLabel: "จำนวนเงินที่ชำระ",
                trackCta: "ติดตามสถานะ",
                homeCta: "กลับหน้าหลัก"
            }
        },
        amendment: {
            title: "แก้ไขข้อมูลในใบรับรอง",
            certLabel: "ใบรับรองเลขที่:",
            back: "ย้อนกลับ",
            stepEditLabel: "แก้ไขข้อมูล",
            stepEditDesc: "ระบุข้อมูลที่ต้องการเปลี่ยน",
            stepConfirmLabel: "ยืนยัน",
            stepConfirmDesc: "ตรวจสอบความถูกต้อง",
            fields: {
                siteName: "ชื่อสถานประกอบการ",
                address: "ที่อยู่",
                contactPhone: "เบอร์โทรศัพท์",
                contactEmail: "อีเมล"
            },
            previousLabel: "เดิม: {value}",
            changeReasonLabel: "เหตุผลในการแก้ไข",
            changeReasonDesc: "โปรดระบุสาเหตุที่ต้องการแก้ไขข้อมูล",
            reviewCta: "ตรวจสอบการแก้ไข ({count})",
            confirmNotice: "หลังจากส่งคำขอ ทีมงานจะประเมินและส่งใบเสนอราคาให้คุณผ่านระบบ",
            tableChangedItem: "รายการที่แก้ไข",
            tableOldData: "ข้อมูลเดิม",
            tableNewData: "ข้อมูลใหม่",
            reasonLabel: "เหตุผลในการแก้ไข:",
            backStep: "ย้อนกลับ",
            submitCta: "ส่งคำขอแก้ไข",
            successTitle: "ส่งคำขอแก้ไขเรียบร้อย",
            successBody1: "ทีมงานจะตรวจสอบและส่งใบเสนอราคาให้คุณ",
            successBody2: "กรุณาตรวจสอบในหน้า \"การเงิน\" เพื่อดูสถานะ",
            backToList: "กลับหน้าคำขอ",
            goToPayments: "ไปหน้าการเงิน"
        },
        replacement: {
            title: "ขอใบรับรองแทน",
            subtitle: "กรณีใบรับรองสูญหายหรือถูกทำลาย",
            back: "ย้อนกลับ",
            stepReasonLabel: "เลือกสาเหตุ",
            stepReasonDesc: "ระบุเหตุผล",
            stepEvidenceLabel: "แนบหลักฐาน",
            stepEvidenceDesc: "อัพโหลดเอกสาร",
            stepConfirmLabel: "ยืนยัน",
            stepConfirmDesc: "ตรวจสอบข้อมูล",
            reasonGroupLabel: "สาเหตุที่ต้องขอใบรับรองแทน",
            reasonGroupDesc: "กรุณาเลือกสาเหตุที่ตรงกับความเป็นจริง",
            reasonLost: "ใบรับรองสูญหาย (ต้องแนบใบแจ้งความ)",
            reasonDamaged: "ใบรับรองถูกทำลายหรือลบเลือน (ต้องแนบใบรับรองที่ชำรุด)",
            next: "ถัดไป",
            evidenceLost: "แนบใบแจ้งความจากสถานีตำรวจ",
            evidenceDamaged: "แนบภาพถ่ายใบรับรองที่ชำรุด",
            placeholderLost: "คลิกเพื่อเลือกไฟล์ใบแจ้งความ",
            placeholderDamaged: "คลิกเพื่อเลือกไฟล์ภาพใบรับรอง",
            backStep: "ย้อนกลับ",
            confirmNotice: "หลังจากส่งคำขอ ทีมงานจะประเมินและส่งใบเสนอราคาให้คุณผ่านระบบ",
            tableOriginal: "ใบรับรองเดิม",
            tableReason: "สาเหตุ",
            tableEvidence: "หลักฐาน",
            badgeLost: "สูญหาย",
            badgeDamaged: "ชำรุด",
            submitErrorTitle: "ส่งคำขอไม่สำเร็จ",
            submitCta: "ส่งคำขอ",
            errorMissingEvidence: "กรุณาแนบหลักฐานก่อนส่งคำขอ",
            errorUploadFailed: "อัพโหลดหลักฐานไม่สำเร็จ กรุณาลองอีกครั้ง",
            errorSubmitFailed: "ส่งคำขอไม่สำเร็จ กรุณาลองอีกครั้ง",
            errorGeneric: "เกิดข้อผิดพลาดระหว่างส่งคำขอ",
            successTitle: "ส่งคำขอเรียบร้อย",
            successBody1: "ทีมงานจะตรวจสอบและส่งใบเสนอราคาให้คุณ",
            successBody2: "กรุณาตรวจสอบในหน้า \"การเงิน\" เพื่อดูสถานะ",
            backToList: "กลับหน้าคำขอ",
            goToPayments: "ไปหน้าการเงิน"
        },
        reports: {
            eyebrow: "ผู้ขอรับรอง · รายงาน",
            title: "รายงานรายเดือน",
            description: "ส่งรายงาน ภ.ท.27 / ภ.ท.28 ตามเงื่อนไขใบรับรอง GACP",
            emptyNoCertsTitle: "ยังไม่มีใบรับรอง GACP",
            emptyNoCertsBody: "เมื่อคุณได้รับใบรับรอง GACP แล้ว จะต้องส่งรายงาน ภ.ท.27 และ ภ.ท.28 เป็นรายเดือน",
            applyCta: "ยื่นคำขอ GACP",
            summary: {
                total: "ทั้งหมด",
                submitted: "ส่งแล้ว",
                pending: "รอส่ง",
                overdue: "เลยกำหนด"
            },
            overdueTitle: "มีรายงานค้าง {count} ฉบับ",
            overdueBody: "กรุณาส่งรายงานที่ค้างส่งโดยเร็ว การส่งรายงานล่าช้าอาจมีผลต่อสถานะใบรับรองของคุณ",
            filterAll: "ทั้งหมด",
            emptyNoReports: "ยังไม่มีรายงานที่ต้องส่ง",
            badgeOverdue: "เลยกำหนด",
            statusSubmitted: "ส่งแล้ว",
            statusApproved: "อนุมัติแล้ว",
            statusRejected: "ต้องแก้ไข",
            statusDraft: "ร่าง",
            submittedOn: "ส่งเมื่อ {date}",
            submitCta: "ส่งรายงาน",
            editCta: "แก้ไข",
            opening: "กำลังเปิดร่างรายงาน...",
            aboutTitle: "เกี่ยวกับรายงาน",
            aboutPT27: "ภ.ท.27 รายงานข้อมูลแหล่งที่มาและจำนวนที่เก็บไว้",
            aboutPT28: "ภ.ท.28 รายงานข้อมูลการนำไปใช้",
            aboutFooter: "ผู้ได้รับใบรับรอง GACP ต้องส่งรายงานทั้ง 2 ประเภทเป็นรายเดือน ตามข้อกำหนดของ พ.ร.บ.สมุนไพร",
            certLabel: "ใบรับรอง {certNumber}"
        },
        sop: {
            pageTitle: "จัดทำขั้นตอนการปฏิบัติงาน (SOP) ออนไลน์",
            pageSubtitle: "กรอกขั้นตอนการปฏิบัติงาน (SOP) ออนไลน์ ระบบจะสร้างเอกสาร PDF ให้อัตโนมัติ",
            betaBadge: "Beta",
            typeLabel: "ประเภท SOP",
            referenceLabel: "อ้างอิง:",
            progressLabel: "ความคืบหน้า",
            progressUnit: "{done}/{total} หมวด",
            saveCta: "บันทึกร่าง",
            pdfCta: "สร้าง PDF",
            savedMessage: "บันทึกร่างเรียบร้อยแล้ว",
            errorMessage: "เกิดข้อผิดพลาด กรุณาลองใหม่",
            pdfPlaceholder: "ระบบจะสร้างเอกสาร SOP เป็น PDF ให้อัตโนมัติ ฟีเจอร์นี้กำลังพัฒนา",
            infoTitle: "หมายเหตุ",
            infoBody1: "SOP ที่จัดทำออนไลน์จะถูกบันทึกในระบบและสามารถแนบเป็นเอกสารประกอบในคำขอรับรอง GACP ได้โดยตรง ไม่ต้องดาวน์โหลดแล้วอัปโหลดใหม่",
            infoBody2: "หากต้องการใช้แบบฟอร์ม PDF/Word แทน",
            infoBody2Link: "ดาวน์โหลดที่นี่",
            gateTitle: "จัดทำขั้นตอนการปฏิบัติงาน (SOP) ออนไลน์",
            gateBody: "ฟีเจอร์นี้กำลังพัฒนา จะเปิดให้ใช้งานเร็ว ๆ นี้",
            gateCta: "ดาวน์โหลดแบบฟอร์ม SOP แทน",
            list: {
                placeholderAdd: "เพิ่มรายการ",
                delete: "ลบ"
            },
            types: {
                planting: "SOP การเพาะปลูกสมุนไพร",
                harvest: "SOP การเก็บเกี่ยว",
                drying: "SOP การตากแห้ง/อบแห้ง",
                hygiene: "SOP สุขลักษณะและสุขอนามัย",
                storage: "SOP การเก็บรักษาและบรรจุ",
                quality: "SOP การควบคุมคุณภาพ",
                record: "SOP การบันทึกข้อมูลและย้อนกลับ"
            },
            sections: {
                objectiveTitle: "วัตถุประสงค์",
                objectiveDescription: "ระบุวัตถุประสงค์ของ SOP นี้ว่าจัดทำเพื่ออะไร",
                objectivePurposeLabel: "วัตถุประสงค์หลัก",
                objectivePurposePlaceholder: "เช่น เพื่อกำหนดขั้นตอนมาตรฐานในการเพาะปลูกสมุนไพร ตามข้อกำหนด GACP",
                scopeTitle: "ขอบเขต",
                scopeDescription: "ระบุขอบเขตการใช้งานของ SOP",
                scopeCoverageLabel: "ขอบเขตที่ครอบคลุม",
                scopeCoveragePlaceholder: "เช่น ครอบคลุมทุกขั้นตอนตั้งแต่การเตรียมดิน เพาะกล้า จนถึงการปลูก สำหรับพืชสมุนไพรทุกชนิดในฟาร์ม",
                scopeApplicableLabel: "ใช้กับ",
                scopeApplicablePlaceholder: "เช่น ฟาร์มสมุนไพร XXX ตำบล YYY อำเภอ ZZZ",
                responsibleTitle: "ผู้รับผิดชอบ",
                responsibleDescription: "ระบุผู้รับผิดชอบในแต่ละขั้นตอน",
                responsibleOwnerLabel: "ผู้จัดทำ / เจ้าของ SOP",
                responsibleOwnerPlaceholder: "ชื่อ-นามสกุล ตำแหน่ง",
                responsibleApproverLabel: "ผู้อนุมัติ",
                responsibleApproverPlaceholder: "ชื่อ-นามสกุล ตำแหน่ง",
                responsibleOperatorsLabel: "ผู้ปฏิบัติงาน",
                responsibleOperatorsPlaceholder: "เพิ่มรายชื่อผู้ปฏิบัติงาน",
                procedureTitle: "ขั้นตอนการปฏิบัติ",
                procedureDescription: "อธิบายขั้นตอนการทำงานอย่างละเอียด",
                procedureStepsLabel: "ขั้นตอน",
                procedureStepsPlaceholder: "เพิ่มขั้นตอนการปฏิบัติ",
                procedureEquipmentLabel: "อุปกรณ์ที่ใช้",
                procedureEquipmentPlaceholder: "เช่น จอบ, พลั่ว, ระบบน้ำหยด, ถุงเพาะ",
                procedurePrecautionsLabel: "ข้อควรระวัง",
                procedurePrecautionsPlaceholder: "เช่น สวมถุงมือขณะสัมผัสสารเคมี, ห้ามรดน้ำเกินกำหนด",
                controlPointsTitle: "จุดควบคุม",
                controlPointsDescription: "จุดวิกฤตที่ต้องควบคุมเป็นพิเศษ (CCP)",
                controlPointsCriticalLabel: "จุดควบคุมวิกฤต (CCP)",
                controlPointsCriticalPlaceholder: "เพิ่มจุดควบคุม เช่น ตรวจสอบคุณภาพน้ำทุก 3 เดือน",
                controlPointsCriteriaLabel: "เกณฑ์การยอมรับ",
                controlPointsCriteriaPlaceholder: "เช่น ค่า pH ของน้ำ 6.5-7.5, ความชื้นในดิน 40-60%",
                recordsTitle: "การบันทึกข้อมูล",
                recordsDescription: "แบบฟอร์มและการบันทึกที่เกี่ยวข้อง",
                recordsFormsLabel: "แบบฟอร์มที่ใช้",
                recordsFormsPlaceholder: "เพิ่มแบบฟอร์ม เช่น แบบบันทึกการรดน้ำ, แบบบันทึกการใส่ปุ๋ย",
                recordsRetentionLabel: "ระยะเวลาเก็บรักษาเอกสาร",
                recordsRetentionPlaceholder: "เช่น 5 ปี"
            },
            referenceLabels: {
                planting: "GACP ข้อ 5.1-5.3",
                harvest: "GACP ข้อ 6.1-6.2",
                drying: "GACP ข้อ 7.1-7.3",
                hygiene: "GACP ข้อ 8.1-8.4",
                storage: "GACP ข้อ 9.1-9.3",
                quality: "GACP ข้อ 10.1-10.2",
                record: "GACP ข้อ 11.1"
            }
        },
        establishments: {
            eyebrow: "ผู้ขอรับรอง · สถานประกอบการ",
            title: "สถานประกอบการ",
            description: "ฟาร์มและแหล่งผลิตที่ได้รับการรับรองมาตรฐาน GACP",
            metricLabel: "ฟาร์มทั้งหมด",
            addCta: "เพิ่มสถานประกอบการ",
            notActiveTitle: "ยังไม่เปิดใช้งาน",
            notActiveBody: "ส่วนนี้เปิดให้เฉพาะผู้ที่ได้รับการรับรองมาตรฐาน GACP แล้วเท่านั้น กรุณายื่นคำขอรับรองใหม่เพื่อเริ่มต้นเข้าสู่ระบบตรวจสอบย้อนกลับ",
            applyCta: "ยื่นคำขอรับรองใหม่",
            backToDashboard: "กลับสู่แดชบอร์ด",
            emptyTitle: "ไม่พบข้อมูลสถานประกอบการ",
            emptyBody: "เมื่อคุณได้รับการรับรองมาตรฐาน GACP ครั้งแรก ฟาร์มที่ผ่านการรับรองจะมาปรากฏที่นี่โดยอัตโนมัติ",
            cardArea: "ขนาดพื้นที่",
            cardType: "ประเภท",
            viewDetails: "ดูรายละเอียด",
            farmTypeCultivation: "เพาะปลูก",
            farmTypeProcessing: "แปรรูป",
            farmTypeOther: "แหล่งผลิต",
            status: {
                draft: "แบบร่าง",
                pendingVerification: "รอตรวจสอบ",
                verified: "ผ่านการรับรอง",
                rejected: "ไม่ผ่าน"
            }
        },
        help: {
            home: {
                metaTitle: "ศูนย์ช่วยเหลือ | GACP THAILAND",
                metaDesc: "ศูนย์ช่วยเหลือสำหรับผู้สมัครรับรองมาตรฐาน GACP รวมคำถามที่พบบ่อย คู่มือ อภิธานศัพท์ และช่องทางติดต่อเจ้าหน้าที่",
                eyebrow: "ศูนย์ช่วยเหลือ · Help Center",
                heroTitle: "วันนี้เราช่วยอะไรคุณได้บ้าง",
                heroBody: "รวมคำตอบเรื่องการสมัคร การชำระเงิน การตรวจฟาร์ม ใบรับรอง การคืนเงิน และการคุ้มครองข้อมูลส่วนบุคคล (PDPA)",
                readFaqCta: "อ่านคำถามที่พบบ่อย",
                contactCta: "ติดต่อเจ้าหน้าที่",
                shortcutsTitle: "ทางลัด",
                shortcutFaqTitle: "คำถามที่พบบ่อย",
                shortcutFaqDesc: "คำตอบ {count} ข้อ จัดหมวดตามหัวข้อ",
                shortcutContactTitle: "ติดต่อเจ้าหน้าที่",
                shortcutContactDesc: "ส่งคำถามถึงทีมช่วยเหลือผ่านอีเมล",
                shortcutGlossaryTitle: "อภิธานศัพท์",
                shortcutGlossaryDesc: "นิยามคำศัพท์ทางการบัญชีและ GACP",
                shortcutOnboardingTitle: "แนะนำการใช้งาน",
                shortcutOnboardingDesc: "ดูขั้นตอนเริ่มต้น 5 ขั้นอีกครั้ง",
                topicsTitle: "หัวข้อทั้งหมด",
                viewAll: "ดูทั้งหมด →",
                viewAllAria: "ดูคำถามทั้งหมด",
                topicQuestions: "{count} คำถาม",
                noAnswerTitle: "ไม่พบคำตอบที่ต้องการ?",
                noAnswerBody: "ทีมงานช่วยเหลือพร้อมตอบทุกคำถามในเวลาราชการ ส่งอีเมลถึงเรา หรืออ่านอภิธานศัพท์เพิ่มเติม",
                emailCta: "ส่งอีเมลถึงเรา",
                contactPageCta: "หน้าติดต่อ",
                glossaryCta: "อภิธานศัพท์"
            },
            faq: {
                metaTitle: "คำถามที่พบบ่อย | ศูนย์ช่วยเหลือ GACP",
                eyebrow: "ศูนย์ช่วยเหลือ · คำถามที่พบบ่อย",
                title: "คำถามที่พบบ่อย ({count} ข้อ)",
                description: "ค้นหาคำตอบสำหรับการใช้งานระบบรับรองมาตรฐาน GACP เลือกหัวข้อหรือใช้ช่องค้นหาด้านล่าง",
                tabListLabel: "หัวข้อคำถาม",
                searchHeading: "ผลการค้นหา \"{query}\" พบ {count} ผลลัพธ์",
                stillNeedHelpTitle: "ยังต้องการความช่วยเหลือ?",
                stillNeedHelpBody: "ส่งคำถามถึงทีมช่วยเหลือผ่านอีเมล หรือดูอภิธานศัพท์เพิ่มเติม",
                contactCta: "ติดต่อเจ้าหน้าที่",
                glossaryCta: "อภิธานศัพท์"
            },
            contact: {
                metaTitle: "ติดต่อศูนย์ช่วยเหลือ | GACP",
                metaDesc: "ส่งคำถามถึงทีมช่วยเหลือผ่านอีเมล สำหรับผู้สมัครรับรองมาตรฐาน GACP",
                eyebrow: "ศูนย์ช่วยเหลือ · ติดต่อเจ้าหน้าที่",
                title: "ติดต่อศูนย์ช่วยเหลือ",
                description: "ส่งคำถามถึงทีมงานผ่านอีเมล ทีมจะตอบกลับภายใน 1-2 วันทำการ",
                formHeading: "แบบฟอร์มร่างอีเมล",
                formDescription: "กรอกข้อมูล แล้วกด \"เปิดในแอปอีเมล\" ระบบจะสร้างร่างอีเมลพร้อมใช้งานในโปรแกรมอีเมลของคุณ",
                topicLabel: "หัวข้อ",
                nameLabel: "ชื่อ-นามสกุล (ไม่บังคับ)",
                appIdLabel: "เลขที่คำขอ (ถ้ามี)",
                appIdPlaceholder: "เช่น APP-2026-000123",
                subjectLabel: "หัวเรื่อง (ไม่บังคับ)",
                subjectPlaceholder: "[{topic}] คำถามจากผู้สมัคร GACP",
                bodyLabel: "รายละเอียดคำถาม",
                bodyPlaceholder: "เล่ารายละเอียดคำถาม สถานการณ์ และสิ่งที่คุณได้ลองทำมาแล้ว...",
                sendTo: "จะส่งไปยัง:",
                openMailCta: "เปิดในแอปอีเมล",
                signatureHeader: "ข้อมูลผู้ส่ง",
                signatureName: "ชื่อ: {name}",
                signatureAppId: "เลขที่คำขอ: {appId}",
                topics: {
                    application: "การสมัคร / Application",
                    payment: "การชำระเงิน / Payment",
                    audit: "การตรวจฟาร์ม / Audit",
                    certificate: "ใบรับรอง / Certificate",
                    refund: "การคืนเงิน / Refund",
                    pdpa: "PDPA / ความเป็นส่วนตัว",
                    other: "อื่น ๆ"
                }
            },
            glossary: {
                metaTitle: "อภิธานศัพท์ | ศูนย์ช่วยเหลือ GACP",
                metaDesc: "อภิธานศัพท์ทางการบัญชีและ GACP รวมนิยามคำศัพท์สำคัญที่พบในระบบ",
                eyebrow: "ศูนย์ช่วยเหลือ · อภิธานศัพท์",
                title: "อภิธานศัพท์ ({count} คำ)",
                description: "นิยามคำศัพท์ทางการบัญชี การตรวจประเมิน และ GACP ที่ใช้ในระบบ",
                notInListPrefix: "หาคำที่ไม่อยู่ในรายการ?",
                notInListLink: "ส่งอีเมลถึงเราที่หน้าติดต่อ",
                categories: {
                    gacp: "มาตรฐานการปฏิบัติทางการเกษตรที่ดี (GACP)",
                    audit: "การตรวจประเมิน",
                    finance: "การเงินและบัญชี",
                    general: "ทั่วไป"
                }
            }
        }
    }
};
