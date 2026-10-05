export const thPROVIDER = {
provider: {
        nav: {
            dashboard: "หน้าหลัก",
            applications: "คำขอ",
            audits: "ตรวจแปลง",
            certificates: "ใบรับรอง",
            calendar: "ปฏิทิน",
            accounting: "บัญชี",
            analytics: "สถิติ",
            verification: "ตรวจสอบตัวตน",
            management: "จัดการ",
            menuLabel: "เมนู"
        },
        roles: {
            reviewer_auditor: "ผู้ตรวจเอกสาร/ตรวจประเมิน",
            scheduler: "เจ้าหน้าที่จัดคิว",
            accountant: "พนักงานบัญชี",
            admin: "ผู้ดูแลระบบ",
            super_admin: "ผู้ดูแลสูงสุด",
            assessor: "ผู้ตรวจสอบ"
        },
        dashboard: {
            title: "หน้าหลัก",
            subtitle: "ภาพรวมการทำงาน",
            stats: {
                total: "งานทั้งหมดในระบบ",
                pendingDocs: "รอตรวจเอกสาร",
                pendingAudits: "รอเข้าตรวจแปลง",
                approvedToday: "อนุมัติวันนี้"
            },
            tabs: {
                documents: "รอตรวจเอกสาร",
                audits: "รอตรวจประเมิน"
            },
            table: {
                titleDocs: "รายการเอกสารรอตรวจสอบ",
                titleAudits: "รายการนัดหมายตรวจแปลง",
                priority: "ความสำคัญ: สูง",
                headers: {
                    jobId: "รหัสงาน",
                    applicant: "ผู้ยื่นคำขอ",
                    plant: "ชนิดพืช",
                    status: "สถานะ",
                    wait: "เวลารอคอย",
                    action: "จัดการ"
                },
                actions: {
                    verify: "ตรวจสอบ"
                },
                empty: "ไม่มีรายการที่ต้องดำเนินการในขณะนี้"
            },
            tools: {
                title: "เครื่องมือเจ้าหน้าที่",
                users: "จัดการผู้ใช้",
                stats: "รายงานสถิติ",
                accounting: "ระบบบัญชี",
                calendar: "ตารางงาน"
            },
            reviewer: {
                layoutTitle: "หน้าหลักเจ้าหน้าที่",
                layoutSubtitle: "คิวงานและการกำกับ SLA",
                welcome: "ยินดีต้อนรับกลับ",
                officer: "เจ้าหน้าที่",
                description: "เข้าสู่ระบบในฐานะเจ้าหน้าที่ตรวจรับรอง GACP การกระทำในระบบทุกอย่างถูกบันทึกและตรวจสอบ ซิงค์ล่าสุด:",
                refresh: "รีเฟรช",
                viewAll: "ดูทั้งหมด",
                metrics: {
                    totalQueue: "งานทั้งหมด",
                    newToday: "ใหม่วันนี้",
                    awaiting: "รอตอบ",
                    slaRisk: "เสี่ยง SLA"
                },
                roleLabels: {
                    document_reviewer: "ผู้ตรวจเอกสาร",
                    scheduler: "เจ้าหน้าที่จัดคิว",
                    auditor: "ผู้ตรวจประเมิน",
                    account: "พนักงานบัญชี",
                    admin: "ผู้ดูแลระบบ",
                    fallback: "ฝ่ายปฏิบัติการ"
                },
                queue: {
                    title: "คิวงานสำคัญ",
                    searchPlaceholder: "ค้นหา...",
                    searchLabel: "ค้นหารายการในคิว",
                    filterLabel: "กรองตามความสำคัญ",
                    priorityAll: "ทั้งหมด",
                    priorityHigh: "สูง",
                    priorityMedium: "ปานกลาง",
                    priorityNormal: "ปกติ",
                    loadingLabel: "กำลังโหลดคิว",
                    noMatch: "ไม่มีรายการที่ตรงกับตัวกรอง",
                    columns: {
                        application: "คำขอ",
                        applicant: "ผู้ยื่น",
                        stage: "ขั้นตอน",
                        action: "ดำเนินการ"
                    },
                    openAria: "เปิดคำขอ"
                },
                actions: {
                    title: "การดำเนินการล่าสุด"
                },
                secureAccess: {
                    title: "เข้าใช้งานอย่างปลอดภัย",
                    description: "คุณกำลังเข้าถึงพอร์ทัลของรัฐบาลที่มีระบบรักษาความปลอดภัย ทุกเซสชันถูกบันทึกผ่าน Audit Trail"
                }
            }
        },
        applicationsList: {
            title: "การจัดการคำขอ",
            subtitle: "ตรวจสอบและจัดการคำขอใบรับรอง GACP",
            eyebrow: "แพลตฟอร์ม GACP",
            heading: "ทำเนียบคำขอ",
            description: "เข้าถึงคำขอใบรับรอง GACP ทั้งหมดที่ยื่นเข้ามา คุณสามารถกรองตามสถานะ ค้นหาผู้ยื่นคำขอ และจัดการเวิร์กโฟลว์ของแต่ละเคสได้",
            stats: {
                all: "เคสทั้งหมด",
                pendingReview: "รอตรวจ",
                pendingAudit: "รอตรวจแปลง",
                certified: "รับรองแล้ว"
            },
            filters: {
                all: "ทั้งหมด",
                submitted: "ยื่นแล้ว",
                assigned: "ตรวจอยู่",
                approved: "อนุมัติ",
                certified: "รับรอง",
                revision: "ส่งแก้ไข",
                docApproved: "เอกสารผ่าน"
            },
            totalRecords: "ทั้งหมด {count} รายการ",
            searchPlaceholder: "ค้นหาชื่อผู้สมัคร / เลขคำขอ / เลขบัตร",
            searchAria: "ค้นหาคำขอ",
            columns: {
                idSubmission: "เลขคำขอและวันยื่น",
                applicantName: "ชื่อผู้ยื่นคำขอ",
                plantType: "ชนิดพืช",
                status: "สถานะ",
                actions: "จัดการ"
            },
            empty: {
                title: "ไม่พบรายการคำขอในหมวดนี้",
                hint: "ลองเปลี่ยนตัวกรองด้านบน หรือตรวจสอบให้แน่ใจว่ามีคำขอในสถานะนี้แล้ว"
            }
        },
        applicationDetail: {
            loadingTitle: "กำลังโหลดคำขอ...",
            title: "ตรวจสอบคำขอ",
            subtitle: "ตรวจสอบความถูกต้องตามระเบียบ",
            notFoundTitle: "ไม่พบข้อมูล",
            notFoundDescription: "ไม่พบข้อมูลคำขอ หรือไม่มีสิทธิ์เข้าถึง",
            backToList: "กลับไปยังรายการ",
            eyebrow: "การตรวจสอบมาตรฐาน",
            descriptionTemplate: "ผู้ยื่นคำขอ: {applicant} คำขอปลูก {plant} ที่ {farm} สถานะปัจจุบัน {status}",
            actions: {
                print: "พิมพ์แบบฟอร์ม",
                backToList: "กลับไปยังรายการ"
            },
            metrics: {
                slaStatus: "สถานะ SLA",
                submitted: "วันยื่น",
                status: "สถานะ",
                urgency: "ความเร่งด่วน",
                urgencyHigh: "สูง",
                urgencyNormal: "ปกติ"
            },
            actionPanel: {
                eyebrow: "รอการดำเนินการ",
                title: "รอผลการตรวจ",
                approve: "อนุมัติเอกสาร",
                requestRevision: "ขอให้แก้ไข"
            },
            readonlyNotice: {
                title: "บัญชีของคุณดูได้อย่างเดียว",
                description: "เฉพาะผู้ตรวจเอกสาร ผู้ตรวจประเมิน หรือผู้ดูแลระบบเท่านั้นที่อนุมัติหรือขอแก้ไขคำขอนี้ได้"
            },
            sections: {
                applicant: "ผู้ยื่นคำขอ",
                farmLocation: "ที่ตั้งฟาร์ม",
                viewOnMaps: "เปิดดูแปลงในแผนที่",
                productionPlan: "แผนการผลิต",
                postHarvest: "หลังการเก็บเกี่ยว"
            },
            details: {
                plant: "พืช",
                type: "ประเภท",
                latitude: "ละติจูด",
                longitude: "ลองจิจูด",
                plantCount: "จำนวนต้น",
                estYield: "ผลผลิตประมาณ",
                seedSource: "แหล่งเมล็ดพันธุ์",
                harvestMethod: "วิธีเก็บเกี่ยว",
                dryingMethod: "วิธีตาก",
                storage: "การเก็บรักษา"
            },
            tabs: {
                overview: "ภาพรวม",
                documents: "เอกสาร",
                stepReview: "ตรวจตามขั้นตอน",
                activities: "งาน",
                reviewHistory: "ประวัติการตรวจ"
            },
            history: {
                empty: "ไม่พบประวัติการตรวจสอบ",
                statusUpdated: "อัปเดตสถานะ",
                noComment: "ไม่มีหมายเหตุ",
                by: "โดย",
                system: "ระบบ"
            }
        },
        documentsTab: {
            checklist: "รายการเอกสาร",
            preview: "ตัวอย่างเอกสาร",
            previewBtn: "ดูตัวอย่าง",
            openBtn: "เปิด",
            missing: "ไม่มี",
            needsRevision: "ต้องแก้ไข",
            previewHint: "คลิก \"ดูตัวอย่าง\" เพื่อแสดงเอกสารตรงนี้",
            mobilePreviewTitle: "ตัวอย่างเอกสาร",
            mobilePreviewDescription: "ตัวอย่างเอกสารที่เลือก",
            mobilePreviewEmpty: "ยังไม่ได้เลือกเอกสาร"
        },
        reviewProgress: {
            revisionTitle: "ต้องการให้แก้ไข",
            changesDetected: "ฟิลด์ที่แก้ไขแล้ว (Changes Detected)",
            editedAt: "แก้ไขเมื่อ",
            stepLabels: {
                step1: "ข้อมูลผู้ยื่นคำขอ",
                step2: "ข้อมูลแปลงปลูก",
                step3: "ข้อมูลการเพาะปลูก",
                step4: "ผลตรวจดินและน้ำ",
                step5: "การจัดการศัตรูพืช",
                step6: "การเก็บเกี่ยว",
                step7: "การตากผึ่ง/อบแห้ง",
                step8: "การเก็บรักษา",
                step9: "เอกสารประกอบ"
            }
        },
        applications: {
            title: "คำขอทั้งหมด",
            subtitle: "รายการคำขอใบรับรอง GACP",
            stats: {
                all: "คำขอทั้งหมด",
                pendingReview: "รอตรวจเอกสาร",
                pendingAudit: "รอตรวจแปลง",
                approved: "อนุมัติแล้ว"
            },
            filters: {
                all: "ทั้งหมด",
                pendingReview: "รอตรวจ",
                revision: "แก้ไข",
                pendingAudit: "ตรวจแปลง",
                approved: "อนุมัติ"
            },
            table: {
                headers: {
                    id: "เลขที่คำขอ",
                    applicant: "ผู้ยื่น",
                    plant: "พืช",
                    status: "สถานะ",
                    date: "วันที่ยื่น",
                    action: ""
                },
                view: "ตรวจสอบ",
                empty: "ไม่พบข้อมูลคำขอ"
            },
            status: {
                submitted: "ยื่นคำขอใหม่",
                pendingReview: "รอตรวจเอกสาร",
                revision: "ส่งคืนแก้ไข",
                documentApproved: "เอกสารผ่าน",
                pendingAudit: "รอตรวจแปลง",
                approved: "รับรองแล้ว"
            }
        },
        audits: {
            title: "การตรวจประเมินทั้งหมด",
            subtitle: "ระบบจัดการการตรวจประเมินภาคสนาม",
            filters: {
                all: "ทั้งหมด",
                waitingSchedule: "รอจัดคิว",
                scheduled: "นัดหมายแล้ว",
                waitingResult: "รอบันทึกผล",
                passed: "ผ่าน",
                failed: "ไม่ผ่าน"
            },
            buttons: {
                calendar: "ปฏิทินนัดหมาย"
            },
            table: {
                headers: {
                    id: "หมายเลข",
                    applicant: "ผู้ยื่น",
                    plant: "พืช",
                    status: "สถานะ",
                    appointment: "นัดหมาย",
                    action: ""
                },
                actions: {
                    schedule: "นัดหมาย",
                    view: "ดูรายละเอียด"
                },
                inspector: "ผู้ตรวจ",
                calendar: "+ ปฏิทิน",
                empty: "ไม่พบรายการตรวจประเมิน"
            },
            status: {
                waitingSchedule: "รอจัดคิว",
                scheduled: "นัดหมายแล้ว",
                inProgress: "กำลังตรวจ",
                waitingResult: "รอบันทึกผล",
                passed: "ผ่าน",
                failed: "ไม่ผ่าน"
            },
            scheduleModal: {
                title: "นัดหมายตรวจประเมิน",
                date: "วันที่",
                time: "เวลา",
                mode: "รูปแบบ",
                onsite: "ลงพื้นที่",
                online: "ออนไลน์",
                cancel: "ยกเลิก",
                confirm: "ยืนยัน"
            },
            dashboard: {
                eyebrow: "หน้าหลักผู้ตรวจประเมิน",
                title: "แดชบอร์ดผู้ตรวจ",
                description: "จัดการคิวการตรวจ ติดตามผล และดูปฏิทินงานของคุณในที่เดียว",
                refresh: "รีเฟรชข้อมูล",
                refreshAria: "รีเฟรชข้อมูลแดชบอร์ด",
                metrics: {
                    todayPassed: "ตรวจวันนี้",
                    scheduledThisWeek: "นัดสัปดาห์นี้",
                    pendingResults: "รอผล",
                    majorTriggers: "ข้อบกพร่อง"
                },
                tabs: {
                    today: "วันนี้",
                    inProgress: "กำลังทำ",
                    followUps: "ติดตาม"
                },
                actions: {
                    meeting: "ประชุม",
                    map: "แผนที่",
                    start: "เริ่มงาน",
                    details: "รายละเอียด",
                    online: "ออนไลน์",
                    onsite: "หน้างาน",
                    pendingReceipt: "ค้างใบเสร็จ"
                },
                ariaLabels: {
                    meetingLink: "เปิดลิงก์ประชุมสำหรับ {id}",
                    mapLink: "เปิดแผนที่สำหรับ {id}",
                    details: "รายละเอียดงานตรวจ {id}"
                },
                empty: {
                    queueTitle: "ไม่มีรายการในคิวนี้",
                    queueHint: "คิวว่างพอดี เปลี่ยนแท็บด้านบนเพื่อดูคิวอื่น หรือพักก่อน"
                },
                schedule: {
                    title: "กำหนดการตรวจ",
                    empty: "ไม่มีนัดตรวจที่จะถึง",
                    online: "ONLINE",
                    onsite: "ONSITE",
                    readyToStart: "พร้อมเริ่ม"
                },
                kpi: {
                    title: "สรุปประสิทธิภาพ (KPI)",
                    todayCompleted: "ตรวจเสร็จวันนี้",
                    scheduledThisWeek: "นัดสัปดาห์นี้",
                    pendingResults: "รอสรุปผล",
                    majorFindings: "ข้อบกพร่องรุนแรง"
                },
                loadFailedTitle: "โหลดไม่สำเร็จ",
                loadFailed: "ไม่สามารถโหลดข้อมูลแดชบอร์ดผู้ตรวจ",
                startSuccessTitle: "เริ่มตรวจสำเร็จ",
                startSuccessMessage: "งานถูกย้ายไปคิวกำลังตรวจ",
                startFailedTitle: "เริ่มตรวจไม่สำเร็จ",
                startFailed: "ไม่สามารถเริ่มตรวจได้",
                inspectionStartedComment: "เริ่มตรวจจากแดชบอร์ด",
                errorTitle: "ข้อผิดพลาด",
                errorGeneric: "เกิดข้อผิดพลาด"
            },
            detail: {
                loadingTitle: "ใบงานตรวจสอบ",
                loadingSubtitle: "กำลังโหลด...",
                notFoundTitle: "ใบงานตรวจสอบ",
                notFoundSubtitle: "ไม่พบคำขอ",
                notFoundMessage: "ไม่สามารถโหลดข้อมูลคำขอสำหรับงานตรวจนี้",
                backToDashboard: "กลับสู่หน้าหลักผู้ตรวจ",
                pageTitle: "ใบงาน {id}",
                pageSubtitle: "ผู้ยื่นคำขอ: {applicant}",
                pendingReceipt: "รอใบเสร็จ",
                scheduledLabel: "นัดตรวจ:",
                revisionDueLabel: "กำหนดส่งฉบับแก้ไข",
                print: "พิมพ์",
                joinMeeting: "เข้าร่วมประชุม",
                openMap: "เปิดแผนที่",
                vocabBanner: "การตัดสินใจสามารถบันทึกจากสองทาง: ใช้ \"เครื่องมือภาคสนาม\" (PASS/FAIL/NEEDS_REVIEW) สำหรับการตรวจสถานที่จริง หรือ \"Job Sheet\" (PASS/MINOR/MAJOR) สำหรับการตรวจเอกสาร กรุณาตรวจสอบให้ตรงกับชนิดงาน",
                tabs: {
                    application: "ข้อมูลคำขอ",
                    history: "ประวัติการตรวจ",
                    audit: "บันทึกการตรวจ",
                    fieldtools: "เครื่องมือภาคสนาม"
                },
                workflowHistory: "ประวัติเวิร์กโฟลว์",
                workflowEmpty: "ยังไม่มีประวัติเวิร์กโฟลว์",
                auditLog: "บันทึกการตรวจสอบ",
                auditLogEmpty: "ยังไม่มีบันทึกการตรวจสอบ",
                actions: {
                    title: "เลขที่งาน:",
                    startInspection: "เริ่มตรวจ",
                    pass: "ผ่าน (PASS)",
                    minorCar: "Minor CAR",
                    majorCar: "Major CAR",
                    notActionable: "งานนี้ไม่อยู่ในสถานะที่สามารถดำเนินการได้ กรุณาตรวจสอบสถานะใบเสร็จและ Workflow"
                },
                applicantInfo: {
                    title: "ข้อมูลผู้ยื่นคำขอ",
                    name: "ชื่อ-สกุล",
                    email: "อีเมล",
                    phone: "โทรศัพท์",
                    applyDate: "วันที่สมัคร"
                },
                summary: {
                    title: "สรุปคำขอ",
                    plant: "พืช",
                    areaType: "ประเภทพื้นที่",
                    province: "จังหวัด",
                    updated: "อัปเดตล่าสุด"
                },
                docs: {
                    title: "เอกสารประกอบ (คลิกเพื่อดู)",
                    viewBtn: "ดูเอกสาร",
                    openNewBtn: "เปิดใหม่",
                    noDoc: "ไม่มีเอกสาร",
                    auditorNote: "หมายเหตุ Auditor",
                    notePlaceholder: "บันทึกข้อสังเกตสำหรับเอกสารนี้...",
                    notePendingTooltip: "บันทึกหมายเหตุต่อเอกสารยังไม่พร้อมใช้งาน (X3.5)",
                    notePending: "บันทึกหมายเหตุต่อเอกสารยังไม่พร้อมใช้งาน (X3.5)"
                },
                viewer: {
                    zoomOut: "ย่อ",
                    zoomIn: "ขยาย",
                    rotate: "หมุน",
                    close: "ปิดเอกสาร",
                    noPreview: "ไม่สามารถแสดงตัวอย่างได้",
                    download: "ดาวน์โหลดเอกสาร",
                    selectDoc: "เลือกเอกสารจากรายการด้านซ้าย",
                    clickToView: "คลิก \"ดูเอกสาร\" เพื่อแสดงในหน้าจอนี้"
                }
            },
            inspect: {
                pageTitle: "ตรวจประเมินภาคสนาม",
                pageSubtitle: "เครื่องมือเก็บข้อมูลสำหรับผู้ตรวจ",
                noAccess: "ไม่มีสิทธิ์เข้าถึง",
                noAccessHint: "บัญชีของคุณไม่มีสิทธิ์ใช้เครื่องมือนี้",
                gpsTitle: "พิกัด GPS",
                gpsCapture: "บันทึกตำแหน่งปัจจุบัน",
                gpsLatLng: "ละติจูด {lat} / ลองจิจูด {lng}",
                gpsAccuracy: "ความแม่นยำ {accuracy} เมตร",
                photoTitle: "ภาพถ่าย",
                photoTake: "ถ่ายภาพ",
                photoCount: "{count} ภาพ",
                photoCaption: "หมายเหตุภาพ",
                photoRemove: "ลบ",
                checklistTitle: "รายการตรวจ",
                checklistPass: "ผ่าน",
                checklistFail: "ไม่ผ่าน",
                checklistNeedsReview: "ต้องทบทวน",
                notesTitle: "บันทึก",
                notesPlaceholder: "บันทึกข้อสังเกตและรายละเอียดเพิ่มเติม...",
                submitBtn: "บันทึกผล",
                cancelBtn: "ยกเลิก",
                submittingLabel: "กำลังบันทึก...",
                successMsg: "บันทึกผลการตรวจเรียบร้อย",
                errorMsg: "ไม่สามารถบันทึกผลได้ กรุณาลองใหม่"
            }
        },
        coordinator: {
            title: "ห้องประสานงานตรวจประเมิน",
            subtitle: "จัดคิวและมอบหมายผู้ตรวจประเมินภาคสนาม",
            eyebrow: "ห้องประสานงาน",
            refresh: "รีเฟรช",
            refreshAria: "รีเฟรชข้อมูลคิว",
            metrics: {
                pending: "รอจัดคิว",
                assigned: "มอบหมายแล้ว",
                today: "วันนี้",
                thisWeek: "สัปดาห์นี้"
            },
            queue: {
                title: "คิวรอจัดคิว",
                emptyTitle: "ไม่มีคำขอรอจัดคิว",
                emptyHint: "ทุกคำขอได้รับการมอบหมายแล้ว",
                assignBtn: "มอบหมาย",
                viewBtn: "ดู",
                receiptIssued: "ออกใบเสร็จแล้ว",
                receiptPending: "รอออกใบเสร็จ"
            },
            assigned: {
                title: "คำขอที่จัดคิวแล้ว",
                empty: "ยังไม่มีคำขอที่จัดคิว",
                inspector: "ผู้ตรวจ",
                appointment: "นัดหมาย",
                changeBtn: "เปลี่ยน",
                cancelBtn: "ยกเลิก"
            },
            contextPanel: {
                title: "ภาพรวมข้อมูลคำขอ",
                applicant: "ผู้ยื่นคำขอ",
                farm: "ฟาร์ม",
                plant: "พืช",
                province: "จังหวัด",
                contactPhone: "โทร.",
                contactEmail: "อีเมล",
                docs: "เอกสาร",
                receipt: "ใบเสร็จ",
                receiptIssued: "ออกแล้ว",
                receiptPending: "ค้าง"
            }
        },
        calendar: {
            title: "ปฏิทินตรวจประเมิน",
            subtitle: "ดูตารางนัดตรวจประเมินทั้งหมด",
            eyebrow: "ปฏิทินงานตรวจประเมิน",
            today: "วันนี้",
            scheduleBtn: "นัดหมายใหม่",
            metrics: {
                today: "นัดวันนี้",
                thisWeek: "สัปดาห์นี้",
                thisMonth: "เดือนนี้",
                pending: "รอจัด"
            },
            emptyTitle: "ไม่มีนัดในช่วงนี้",
            emptyHint: "กดปุ่ม \"นัดหมายใหม่\" เพื่อจัดตารางนัดตรวจ",
            scheduleModal: {
                title: "นัดหมายตรวจประเมิน",
                applicationLabel: "เลขที่คำขอ",
                applicantLabel: "ผู้ยื่นคำขอ",
                inspectorLabel: "ผู้ตรวจประเมิน",
                inspectorPlaceholder: "เลือกผู้ตรวจ",
                dateLabel: "วันที่นัดตรวจ",
                timeLabel: "เวลา",
                modeLabel: "รูปแบบการตรวจ",
                modeOnsite: "ลงพื้นที่",
                modeOnline: "ออนไลน์",
                meetingLinkLabel: "ลิงก์ประชุม",
                mapLinkLabel: "ลิงก์แผนที่",
                notesLabel: "บันทึก",
                notesPlaceholder: "ข้อมูลเพิ่มเติมเกี่ยวกับการนัด...",
                submitBtn: "ยืนยันนัดหมาย",
                cancelBtn: "ยกเลิก",
                submittingLabel: "กำลังบันทึก...",
                successTitle: "นัดหมายสำเร็จ",
                successMsg: "การนัดหมายถูกบันทึกเรียบร้อย",
                errorTitle: "นัดหมายไม่สำเร็จ",
                errorMsg: "ไม่สามารถบันทึกนัดหมายได้"
            }
        },
        scheduler: {
            queue: {
                title: "คิวจัดคิวผู้ตรวจ",
                subtitle: "รายการคำขอรอจัดคิวเข้าตรวจประเมิน",
                emptyTitle: "ไม่มีรายการในคิว",
                emptyHint: "ทุกรายการได้รับการจัดคิวแล้ว"
            },
            reassign: {
                title: "เปลี่ยนผู้ตรวจประเมิน",
                subtitle: "เปลี่ยนผู้ตรวจที่กำหนดให้กับคำขอนี้",
                currentInspector: "ผู้ตรวจปัจจุบัน",
                newInspector: "ผู้ตรวจใหม่",
                inspectorPlaceholder: "เลือกผู้ตรวจ",
                reasonLabel: "เหตุผลในการเปลี่ยน",
                reasonPlaceholder: "ระบุเหตุผล...",
                submitBtn: "ยืนยันเปลี่ยน",
                cancelBtn: "ยกเลิก",
                submittingLabel: "กำลังบันทึก...",
                successTitle: "เปลี่ยนผู้ตรวจสำเร็จ",
                successMsg: "ผู้ตรวจถูกเปลี่ยนเรียบร้อย",
                errorTitle: "เปลี่ยนไม่สำเร็จ",
                errorMsg: "ไม่สามารถเปลี่ยนผู้ตรวจได้"
            }
        },
        work: {
            list: {
                title: "คิวงาน",
                subtitle: "งานที่ได้รับมอบหมาย",
                eyebrow: "ภาพรวมงาน",
                refresh: "รีเฟรช",
                tabsAll: "ทั้งหมด",
                tabsOpen: "เปิดอยู่",
                tabsClaimed: "รับงาน",
                tabsDone: "เสร็จสิ้น",
                emptyTitle: "ไม่มีงานในคิว",
                emptyHint: "เมื่อมีงานเข้ามาใหม่จะแสดงที่นี่",
                columns: {
                    workType: "ประเภทงาน",
                    application: "คำขอ",
                    state: "สถานะ",
                    due: "ครบกำหนด",
                    assigned: "ผู้รับ"
                },
                stateLabels: {
                    TODO: "รอรับงาน",
                    CLAIMED: "รับงานแล้ว",
                    IN_PROGRESS: "กำลังทำ",
                    DONE: "เสร็จ",
                    CANCELLED: "ยกเลิก"
                },
                workTypeLabels: {
                    SCHEDULING: "จัดคิว",
                    DOC_REVIEW: "ตรวจเอกสาร",
                    FIELD_AUDIT: "ตรวจประเมินภาคสนาม",
                    CAR_REVIEW: "ตรวจ CAR",
                    FINAL_APPROVAL: "อนุมัติออกใบรับรอง",
                    RECEIPT_ISSUE: "ออกใบเสร็จ"
                }
            },
            detail: {
                title: "รายละเอียดงาน",
                subtitle: "ข้อมูลงานและประวัติ",
                back: "กลับ",
                claimBtn: "รับงาน",
                startBtn: "เริ่มทำ",
                completeBtn: "ปิดงาน",
                cancelBtn: "ยกเลิก",
                applicationLink: "ดูคำขอ",
                noteLabel: "บันทึก",
                notePlaceholder: "เพิ่มบันทึก...",
                cancelReasonLabel: "เหตุผลในการยกเลิก",
                cancelReasonPlaceholder: "ระบุเหตุผล...",
                history: "ประวัติงาน",
                createdAt: "สร้างเมื่อ",
                claimedAt: "รับเมื่อ",
                startedAt: "เริ่มเมื่อ",
                completedAt: "เสร็จเมื่อ",
                cancelledAt: "ยกเลิกเมื่อ",
                dueAt: "ครบกำหนด",
                assignedTo: "ผู้รับ",
                completedBy: "ปิดโดย"
            }
        },
        analytics: {
            pageTitle: "วิเคราะห์และรายงาน",
            pageSubtitle: "ประสิทธิภาพและสถิติระบบ",
            eyebrow: "ข้อมูลเชิงลึกสำหรับเจ้าหน้าที่",
            heading: "ภาพรวมการวิเคราะห์ระบบ",
            description: "ภาพรวมประสิทธิภาพของระบบ แนวโน้มคำขอ และตัวชี้วัดการเงินใน {days} วันที่ผ่านมา",
            refresh: "รีเฟรช",
            workKpis: "KPI งาน",
            retry: "ลองใหม่",
            errorMessage: "ไม่สามารถโหลดข้อมูลวิเคราะห์ได้",
            errorRetry: "ไม่สามารถโหลดข้อมูลวิเคราะห์ได้ กรุณาลองใหม่",
            periods: {
                last7: "7 วันที่ผ่านมา",
                last30: "30 วันที่ผ่านมา",
                last90: "90 วันที่ผ่านมา",
                lastYear: "ปีที่แล้ว",
                placeholder: "ช่วงเวลา"
            },
            metrics: {
                totalApps: "คำขอทั้งหมด",
                approved: "อนุมัติแล้ว",
                revenue: "รายได้",
                farmers: "เกษตรกร"
            },
            cards: {
                totalApplications: "คำขอทั้งหมด",
                totalRevenue: "รายได้รวม",
                activeFarmers: "เกษตรกรที่ใช้งาน",
                certificatesIssued: "ใบรับรองที่ออก",
                newSuffix: "ใหม่",
                renewalsSuffix: "ต่ออายุ",
                pendingPrefix: "ค้างชำระ:",
                newThisPeriod: "ใหม่ในช่วงนี้",
                approvedTotal: "อนุมัติทั้งหมด"
            },
            tabs: {
                overview: "ภาพรวม",
                performance: "ประสิทธิภาพ",
                geographic: "ภูมิศาสตร์"
            },
            charts: {
                trends: "แนวโน้มคำขอ",
                date: "วันที่",
                applications: "คำขอ",
                approved: "อนุมัติ",
                revenue: "รายได้",
                plantTypeDist: "การกระจายตามชนิดพืช",
                units: "หน่วย",
                topProvinces: "จังหวัดที่มีปริมาณสูงสุด",
                province: "จังหวัด",
                marketShare: "ส่วนแบ่ง",
                distribution: "การกระจาย"
            },
            performance: {
                avgProcessing: "เฉลี่ยการประมวลผล",
                avgAudit: "เฉลี่ยการตรวจ",
                satisfaction: "ความพึงพอใจ",
                days: "วัน",
                targetProcessing: "เป้าหมาย: 14 วัน",
                targetAudit: "เป้าหมาย: 3 วัน",
                userRating: "คะแนนผู้ใช้"
            }
        },
        profile: {
            pageTitle: "โปรไฟล์เจ้าหน้าที่",
            pageSubtitle: "ข้อมูลบัญชีและการควบคุมการเข้าถึง",
            eyebrow: "การจัดการตัวตน",
            fallbackTitle: "โปรไฟล์เจ้าหน้าที่",
            description: "จัดการรายละเอียดบัญชีเจ้าหน้าที่ ดูบทบาทที่ได้รับ และเข้าใจสิทธิ์การเข้าถึงระบบของคุณ",
            refresh: "รีเฟรช",
            logout: "ออกจากระบบ",
            errorPrefix: "ไม่สามารถโหลดข้อมูลโปรไฟล์ได้",
            metrics: {
                role: "บทบาท",
                verified: "ยืนยันแล้ว",
                status: "สถานะ",
                yes: "ใช่",
                no: "ไม่",
                active: "ใช้งาน"
            },
            sections: {
                officialIdentity: "ข้อมูลตัวตนทางการ",
                contactInfo: "ข้อมูลติดต่อ",
                permissions: "สิทธิ์ที่ได้รับอนุญาต",
                sessionGov: "เซสชันและการกำกับดูแล"
            },
            ministryVerified: "ผ่านการยืนยันโดยกระทรวง",
            labels: {
                providerId: "รหัสเจ้าหน้าที่",
                accountType: "ประเภทบัญชี",
                email: "อีเมล",
                phone: "โทรศัพท์",
                organization: "หน่วยงาน",
                orgName: "กรมการแพทย์แผนไทยและการแพทย์ทางเลือก"
            },
            quickActions: {
                securityMfa: "ความปลอดภัยและ MFA",
                systemSettings: "ตั้งค่าระบบ",
                notifications: "การแจ้งเตือน",
                dashboard: "แดชบอร์ด",
                endSession: "ออกจากระบบ"
            },
            roleFallback: "การเข้าถึงตามบทบาทเปิดใช้งาน"
        },
        // FU-3 (full-system audit area J, 2026-07-07): the certificates
        // dashboard rendered 100% English with no useLanguage — the chrome
        // LanguageToggle could not localize a core provider surface.
        certificates: {
            title: "ใบรับรอง",
            subtitle: "ติดตามอายุใบรับรองและการต่ออายุ",
            heading: "งานใบรับรอง",
            refresh: "รีเฟรช",
            notifyExpiry: "แจ้งเตือนใกล้หมดอายุ (30 วัน)",
            queueing: "กำลังส่งคิวแจ้งเตือน...",
            metrics: {
                active: "ใบรับรองที่ใช้งานอยู่",
                expiring30: "หมดอายุภายใน 30 วัน",
                expiring90: "หมดอายุภายใน 90 วัน",
                renewalHealth: "อัตราการต่ออายุ",
                lastSync: "ข้อมูลล่าสุด"
            },
            byStandard: "จำแนกตามมาตรฐาน",
            topProvinces: "จังหวัดที่มีใบรับรองมากที่สุด",
            noStandardData: "ยังไม่มีข้อมูลจำแนกตามมาตรฐาน",
            noProvinceData: "ยังไม่มีข้อมูลจำแนกตามจังหวัด",
            unknownStandard: "ไม่ระบุมาตรฐาน",
            unknownProvince: "ไม่ระบุจังหวัด",
            expiringTitle: "ใบรับรองใกล้หมดอายุ (ภายใน 90 วัน)",
            autoSorted: "เรียงตามวันหมดอายุที่ใกล้ที่สุด",
            emptyExpiring: "ไม่มีใบรับรองที่จะหมดอายุภายใน 90 วัน",
            table: {
                certificate: "เลขที่ใบรับรอง",
                farm: "ฟาร์ม",
                standard: "มาตรฐาน",
                province: "จังหวัด",
                expiry: "วันหมดอายุ",
                contact: "ผู้ติดต่อ"
            },
            daysLeftSuffix: "วัน คงเหลือ",
            unknown: "ไม่ทราบ",
            errors: {
                loadFailed: "ไม่สามารถโหลดข้อมูลใบรับรองได้",
                notifyFailed: "ไม่สามารถส่งคิวแจ้งเตือนการต่ออายุได้"
            }
        }
    }
};
