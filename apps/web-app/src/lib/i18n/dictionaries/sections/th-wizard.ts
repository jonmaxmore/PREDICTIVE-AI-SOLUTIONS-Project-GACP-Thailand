import { SERVICE_NAME, SERVICE_NOUN } from '@/lib/pricing/fee-services';
import { SUPPORT_EMAIL } from '@/constants/contact-emails';

export const thWizard = {
wizard: {
        steps: {
            general: "ข้อมูลผู้ยื่น",
            personnel: "การจัดการด้านบุคลากร",
            facilities: "สิ่งอำนวยความสะดวก",
            farm: "ข้อมูลฟาร์ม",
            planting: "การเพาะปลูก",
            production: "ผลผลิต",
            lots: "ล็อตการผลิต",
            review: "ตรวจสอบข้อมูล"
        },
        plantSelection: {
            title: "เลือกพืชสมุนไพร",
            subtitle: "เริ่มต้นการยื่นคำขอรับรองมาตรฐาน GACP",
            sections: {
                plant: "เลือกชนิดพืชสมุนไพร",
                plantDesc: "กรุณาเลือกพืชที่ต้องการขอรับรอง GACP",
                serviceType: "ประเภทคำขอ",
                serviceTypeDesc: "เลือกประเภทการยื่นคำขอของคุณ",
                purpose: "วัตถุประสงค์",
                purposeDesc: "เลือกวัตถุประสงค์การผลิต",
                method: "รูปแบบการปลูก",
                methodDesc: "เลือกวิธีการปลูกสมุนไพร"
            },
            serviceTypes: {
                new: { label: "ขอใหม่", desc: "สำหรับผู้ที่ยังไม่เคยมีใบรับรอง GACP หรือใบรับรองเดิมหมดอายุเกินกำหนดต่ออายุ" },
                renewal: { label: "ต่ออายุ", desc: "สำหรับใบรับรองเดิมที่ใกล้หมดอายุ สามารถยื่นล่วงหน้าได้ 90 วัน" },
                modify: { label: "เปลี่ยนแปลงรายการ", desc: "แก้ไขข้อมูลในใบรับรองเดิม เช่น เปลี่ยนแปลงผู้ดำเนินกิจการ หรือพื้นที่ปลูก" }
            },
            note: "หนึ่งใบคำขอ = หนึ่งรูปแบบการเพาะปลูก หากมีหลายรูปแบบกรุณายื่นแยกคำขอ"
        },
        general: {
            title: "ข้อมูลผู้ยื่นคำขอ",
            subtitle: "กรุณาระบุข้อมูลของผู้ยื่นคำขอให้ครบถ้วน",
            infoHeader: "ข้อมูลผู้สมัคร",
            typeHeader: "เลือกประเภทผู้ยื่นคำขอ",
            types: {
                individual: { label: "บุคคลธรรมดา", subLabel: "บุคคลธรรมดา", idLabel: "เลขบัตรประชาชน 13 หลัก" },
                juristic: { label: "นิติบุคคล", subLabel: "นิติบุคคล", idLabel: "เลขทะเบียนนิติบุคคล 13 หลัก" },
                community: { label: "วิสาหกิจชุมชน", subLabel: "วิสาหกิจชุมชน", idLabel: "เลขทะเบียนวิสาหกิจชุมชน" }
            },
            applicantName: "ชื่อ-นามสกุล ผู้ยื่นคำขอ",
            firstName: "ชื่อ",
            lastName: "นามสกุล",
            personalId: "เลขบัตรประจำตัวประชาชน",
            address: "ที่อยู่ตามบัตรประชาชน",
            contact: "ข้อมูลการติดต่อ",
            email: "อีเมล",
            phone: "เบอร์โทรศัพท์",
            docs: {
                idCard: "สำเนาบัตรประชาชน",
                houseReg: "สำเนาทะเบียนบ้าน",
                communityReg: "หนังสือสำคัญการจดทะเบียนวิสาหกิจชุมชน",
                companyReg: "หนังสือรับรองนิติบุคคล",
                meetingReport: "รายงานการประชุม",
                directorList: "รายชื่อกรรมการ"
            }
        },
        farm: {
            title: "ข้อมูลฟาร์ม",
            subtitle: "รายละเอียดที่ตั้ง สภาพแวดล้อม และระบบความปลอดภัยตามมาตรฐาน GACP",
            sections: {
                general: "ข้อมูลทั่วไปของฟาร์ม",
                environment: "สภาพแวดล้อมพื้นที่ (GACP)",
                sanitation: "สุขอนามัยและสิ่งอำนวยความสะดวก",
                water: "แหล่งน้ำและคุณภาพน้ำ",
                gps: "พิกัดฟาร์ม",
                security: "ระบบรักษาความปลอดภัย",
                documents: "เอกสารประกอบพื้นที่"
            },
            fields: {
                farmName: "ชื่อฟาร์ม/สถานประกอบการ",
                farmNamePlaceholder: "เช่น ไร่สมุนไพรสุขใจ",
                address: "ที่อยู่ฟาร์ม",
                addressPlaceholder: "บ้านเลขที่, หมู่, ถนน...",
                province: "จังหวัด",
                postalCode: "รหัสไปรษณีย์",
                totalArea: "พื้นที่รวม",
                unit: "หน่วย",
                ownership: "กรรมสิทธิ์ที่ดิน",
                ownershipOptions: {
                    owner: "เป็นเจ้าของ",
                    rented: "เช่า",
                    consent: "ได้รับความยินยอม"
                }
            },
            units: {
                sqm: "ตร.ม."
            },
            map: {
                title: "ตำแหน่งพิกัดแปลง",
                currentLocation: "ตำแหน่งปัจจุบัน",
                loading: "กำลังโหลดแผนภาพพื้นที่...",
                lat: "ละติจูด",
                lng: "ลองจิจูด",
                error: "ไม่สามารถระบุตำแหน่งได้"
            },
            borders: {
                title: "อาณาเขตติดต่อ",
                north: "ทิศเหนือ",
                south: "ทิศใต้",
                east: "ทิศตะวันออก",
                west: "ทิศตะวันตก"
            },
            soil: {
                title: "ข้อมูลดินปลูก",
                type: "ลักษณะดิน",
                ph: "ค่าความเป็นกรด-ด่างของดิน (ถ้าทราบ)",
                history: "ประวัติการใช้ที่ดินย้อนหลัง"
            },
            water: {
                source: "แหล่งน้ำที่ใช้",
                quality: "คุณภาพน้ำ",
                status: {
                    pass: "ผ่านเกณฑ์",
                    fail: "ไม่ผ่านเกณฑ์",
                    pending: "รอผลตรวจ"
                }
            },
            docs: {
                landTitle: "เอกสารสิทธิ์ที่ดิน (โฉนด/น.ส.4/ส.ป.ก.)",
                rentalContract: "สัญญาเช่า (กรณีเช่าที่ดิน)",
                consentLetter: "หนังสือยินยอมใช้ที่ดิน",
                farmMap: "แผนที่ฟาร์ม/ผังบริเวณ",
                waterReport: "ผลวิเคราะห์คุณภาพน้ำ"
            }
        },
        plots: {
            title: "การแบ่งแปลงปลูก",
            subtitle: "กำหนดโซนและแปลงย่อยสำหรับสร้างคิวอาร์โค้ดและติดตามผลผลิต",
            summary: {
                title: "สรุปพื้นที่ทั้งหมด",
                totalArea: "พื้นที่ทั้งหมด",
                allocatedArea: "แบ่งแล้ว",
                remainingArea: "คงเหลือ",
                qrCount: "คิวอาร์โค้ด",
                unit: "หน่วย",
                noTotalArea: "ไม่พบข้อมูลพื้นที่รวม: กรุณากรอกข้อมูลในขั้นตอนที่ 3 (ข้อมูลฟาร์ม) ก่อน"
            },
            list: {
                title: "รายการแปลงปลูก",
                empty: {
                    title: "ยังไม่มีแปลงปลูก",
                    subtitle: "กดที่นี่ หรือปุ่มด้านล่างเพื่อเพิ่มแปลงใหม่"
                },
                badges: {
                    soil: "ดิน",
                    seed: "เมล็ดพันธุ์",
                    ipm: "การจัดการศัตรูพืช"
                },
                addTitle: "เพิ่มแปลงใหม่",
                addSubtitle: "คลิกเพื่อกรอกรายละเอียดแปลง",
                addBtn: "เพิ่มแปลง"
            },
            form: {
                name: "ชื่อแปลง",
                namePlaceholder: "เช่น A1, โซน B",
                area: "ขนาดพื้นที่",
                areaPlaceholder: "จำนวน",
                unit: "หน่วย",
                gacpTitle: "ข้อมูลคุณภาพ (GACP)",
                soilType: "ประเภทดิน",
                seedSource: "แหล่งเมล็ดพันธุ์",
                ipmLabel: "มีแผนการจัดการศัตรูพืชแบบผสมผสาน",
                select: "-- เลือก --"
            },
            systems: {
                outdoor: "กลางแจ้ง",
                greenhouse: "โรงเรือน",
                indoor: "ระบบปิด"
            },
            alerts: {
                areaExceeded: "พื้นที่ที่เพิ่ม ({area}) เกินกว่าพื้นที่คงเหลือ ({remaining})"
            }
        },
        documents: {
            title: "การตรวจสอบเอกสารอัจฉริยะ",
            subtitle: "ระบบตรวจสอบความถูกต้องเอกสารด้วยปัญญาประดิษฐ์เพื่อความรวดเร็วในการพิจารณา",
            aiScan: "ตรวจสอบอัตโนมัติ",
            downloadForm: "ดาวน์โหลดแบบฟอร์ม",
            upload: "คลิกเพื่ออัปโหลด",
            dragDrop: "หรือลากไฟล์มาวางที่นี่",
            status: {
                mandatory: "จำเป็นทั้งหมด",
                uploaded: "อัปโหลดแล้ว",
                missing: "เอกสารครบถ้วนแล้ว",
                complete: "เอกสารครบถ้วนแล้ว",
                missingCount: "ขาดอีก {n} รายการ"
            },
            headers: {
                todo: "เอกสารที่ต้องดำเนินการ",
                done: "เอกสารที่เรียบร้อยแล้ว"
            },
            extra: {
                video: "ข้อมูลเพิ่มเติม (ถ้ามี)",
                hint: "ช่วยให้นักวิชาการตรวจสอบสถานที่ได้รวดเร็วขึ้นผ่านวิดีโอ"
            },
            messages: {
                analyzing: "กำลังวิเคราะห์...",
                valid: "เอกสารผ่านการตรวจสอบเบื้องต้น",
                invalid: "เอกสารไม่ถูกต้องหรือข้อมูลไม่ครบ",
                error: "เกิดข้อผิดพลาดในการอัปโหลด"
            },
            docNames: {
                APP_FORM: "แบบลงทะเบียนยื่นคำขอ",
                house_reg: "สำเนาทะเบียนบ้าน",
                land_deed: "หนังสือแสดงกรรมสิทธิ์ที่ดิน/โฉนด",
                land_consent: "หนังสือสัญญาเช่า / ยินยอมใช้ที่ดิน",
                site_map: "แผนที่ตั้ง + พิกัด GPS",
                building_plan: "แบบแปลนอาคาร/โรงเรือน",
                photos_exterior: "ภาพถ่ายบริเวณภายนอก",
                photos_interior: "ภาพถ่ายภายในสถานที่ผลิต",
                production_plan: "แผนการผลิตแต่ละรอบ/ปี",
                security_measures: "มาตรการรักษาความปลอดภัย",
                medical_cert: "ใบรับรองแพทย์ (ผู้ปฏิบัติงาน)",
                elearning_cert: "หนังสือรับรอง E-learning GACP",
                strain_cert: "หนังสือรับรองสายพันธุ์",
                sop_thai: "คู่มือ SOP (ฉบับภาษาไทย)",
                training_records: "เอกสารการอบรมพนักงาน",
                PROVIDER_test: "แบบทดสอบพนักงาน",
                soil_water_test: "ผลตรวจวัสดุปลูก/ดิน/น้ำ",
                flower_test: "ผลตรวจช่อดอก",
                input_report: "รายงานปัจจัยการผลิต",
                cp_ccp_plan: "ตารางแผนควบคุมจุดวิกฤติ",
                calibration_cert: "ใบสอบเทียบเครื่องมือ"
            }
        },
        preview: {
            title: "ตรวจสอบข้อมูล",
            subtitle: "กรุณาตรวจสอบความถูกต้องของข้อมูลก่อนดำเนินการขอใบเสนอราคา",
            print: "พิมพ์ / บันทึก",
            headers: {
                applicant: "ข้อมูลผู้ขอใบรับรอง",
                farm: "ข้อมูลสถานที่ผลิต (ฟาร์ม)",
                plots: "แปลงปลูก",
                production: "ประมาณการผลผลิต",
                documents: "เอกสารประกอบ"
            },
            labels: {
                name: "ชื่อ-นามสกุล / นิติบุคคล",
                id: "เลขบัตรประชาชน / เลขนิติบุคคล",
                phone: "เบอร์โทรศัพท์",
                email: "อีเมล",
                address: "ที่อยู่",
                hygiene: "สุขอนามัยบุคลากร (GACP)",
                farmName: "ชื่อสถานที่ผลิต",
                location: "ที่ตั้ง (จังหวัด)",
                totalArea: "ขนาดพื้นที่ทั้งหมด",
                ownership: "กรรมสิทธิ์",
                water: "แหล่งน้ำ",
                gps: "พิกัด GPS",
                sanitation: "สุขาภิบาล",
                totalPlants: "จำนวนต้นรวม",
                plantingDate: "วันที่เริ่มปลูก",
                docCount: "เอกสารแนบ"
            },
            stats: {
                plots: "แปลงปลูก",
                plants: "จำนวนต้น",
                area: "พื้นที่ (ตร.ม.)",
                docs: "เอกสาร"
            },
            actions: {
                ready: "พร้อมส่งคำขอ",
                expand: "แสดงข้อมูล",
                collapse: "ย่อข้อมูล",
                edit: "แก้ไข",
                next: "ไปที่หน้าส่งคำขอ"
            }
        },
        quote: {
            title: "ใบเสนอราคา",
            subtitle: "กรุณาตรวจสอบและยอมรับใบเสนอราคาเพื่อดำเนินการต่อ",
            milestone1Title: `${SERVICE_NAME.PHASE_1}`,
            milestone1Desc: "การชำระเงินแบ่งเป็น 2 งวด โดยงวดแรกจะเป็นค่าบริการสำหรับผู้เชี่ยวชาญในการตรวจสอบเอกสารคำขอของคุณ\nเมื่อชำระแล้วจะเข้าสู่กระบวนการตรวจสอบภายใน 5-7 วันทำการ",
            dtam: {
                title: "ค่าบริการ",
                subtitle: "ระบบลงทะเบียน",
                footer: "พอร์ทัลลงทะเบียนอย่างเป็นทางการ",
                feeLabel: `${SERVICE_NAME.PHASE_1}`,
            },
            platform: {
                title: "ค่าบริการ Platform",
                subtitle: "บริษัท แกคป์ แพลตฟอร์ม จำกัด",
                feeLabel: "ค่าบริการ",
            },
            buttons: {
                viewDetails: "ดูรายละเอียด",
                accept: "ยอมรับใบเสนอราคา",
                accepted: "ยอมรับแล้ว",
            },
            summary: {
                totalLabel: "ยอดรวมสุทธิ",
                netTotal: "ยอดชำระรวม",
            },
            labels: {
                certBody: "หน่วยรับรอง",
                platform: "แพลตฟอร์มซอฟต์แวร์",
                vatIncluded: "* รวมภาษีมูลค่าเพิ่มแล้ว"
            },
        },
        invoice: {
            title: "ชำระค่าบริการ",
            subtitle: "โปรดชำระเงินตามใบแจ้งหนี้เพื่อดำเนินการในขั้นตอนถัดไป",
            phase1Title: "ชำระค่าบริการ (Payment)",
            phase2Title: `ชำระ${SERVICE_NAME.PHASE_2}`,
            paper: {
                orgName: "ระบบรับรองมาตรฐาน GACP สมุนไพร",
                orgAddress: "88/23 หมู่ 4 ถนนติวานนท์ อำเภอเมือง จังหวัดนนทบุรี 11000",
                invoiceTitle: "ใบวางบิล/แจ้งหนี้ (INVOICE)",
                customer: "ชื่อผู้ขอรับบริการ",
                address: "ที่อยู่",
                date: "วันที่:",
                dueDate: "วันครบกำหนด:",
                no: "เลขที่:",
                note: "เอกสารนี้จัดทำโดยระบบคอมพิวเตอร์",
            },
            table: {
                no: "ลำดับ",
                description: "รายการ",
                amount: "จำนวนเงิน (บาท)",
                total: "ยอดชำระสุทธิ",
            },
            items: {
                standardFee: "ค่าบริการคำขอรับรองมาตรฐาน",
                docCheck: `${SERVICE_NOUN.PHASE_1}`,
                auditFee: `${SERVICE_NOUN.PHASE_2}`,
            },
            payment: {
                qrTitle: "ชำระเงินผ่าน QR Code",
                qrSubtitle: "รองรับ Mobile Banking ทุกธนาคาร",
                actions: {
                    verifying: "กำลังตรวจสอบ...",
                    payViaMobile: "ชำระผ่านแอปธนาคาร",
                    downloadInvoice: "ดาวน์โหลดใบแจ้งหนี้",
                    viewPdf: "ดูไฟล์ฉบับเต็ม"
                },
                supportedMethods: "รองรับการชำระผ่านคิวอาร์โค้ดพร้อมเพย์ไทย, แอปธนาคาร และบัตรเครดิต",
                vatIncluded: "* รวมภาษีมูลค่าเพิ่มแล้ว"
            },
            modal: {
                scanQr: "สแกนคิวอาร์โค้ดเพื่อชำระเงิน",
                simulate: "จำลองการชำระเงินสำเร็จ",
                cancel: "ยกเลิกทำรายการ",
            },
        },
        submit: {
            title: "ยืนยันการส่งคำขอ",
            subtitle: "ตรวจสอบความถูกต้องและยืนยันเพื่อดำเนินการต่อ",
            button: "ยืนยันการส่งคำขอ",
            submitting: "กำลังส่งข้อมูล...",
            infoCard: {
                title: "ข้อมูลผู้ยื่นคำขอ",
                applicantName: "ชื่อผู้ขอรับรอง",
                farmName: "ชื่อฟาร์ม",
                location: "ที่ตั้งฟาร์ม",
                plant: "พืชที่ขอรับรอง"
            },
            declarations: {
                title: "ยืนยันความถูกต้องและยอมรับเงื่อนไข",
                dataCorrect: "ข้าพเจ้ายืนยันว่าข้อมูลทั้งหมดถูกต้องและเป็นความจริงทุกประการ หากมีการตรวจสอบพบว่าเป็นเท็จ ข้าพเจ้ายินยอมให้ยกเลิกคำขอทันที",
                termsAccepted: "ข้าพเจ้ายอมรับเงื่อนไขและข้อกำหนดการรับรองมาตรฐาน GACP ของระบบรับรองมาตรฐาน GACP สมุนไพร",
                paymentUnderstood: `ข้าพเจ้าเข้าใจว่าจะต้องชำระ${SERVICE_NAME.PHASE_2} หลังจากได้รับใบแจ้งหนี้ (Invoice)`
            }
        },
        success: {
            title: "ส่งคำขอสำเร็จ!",
            message: "ขอบคุณที่สมัครเข้าร่วมโครงการ GACP\nทีมงานได้รับข้อมูลของคุณเรียบร้อยแล้ว",
            caseId: "เลขที่คำขอ",
            saveNote: "โปรดบันทึกรหัสนี้ไว้เพื่อติดตามสถานะ",
            status: "สถานะ: รอการตรวจสอบ",
            timeline: {
                title: "ใช้เวลาตรวจสอบ",
                desc: "ประมาณ 3-5 วันทำการ"
            },
            notification: {
                title: "แจ้งเตือนสถานะ",
                desc: "ผ่านข้อความสั้นและอีเมล"
            },
            researchInfo: {
                title: "ติดต่อสอบถาม:",
                project: "โครงการ: พัฒนาและส่งเสริมมาตรฐาน GACP",
                researcher: "หน่วยงาน: ระบบรับรองมาตรฐาน GACP สมุนไพร (DTAM)",
                contact: `โทร: 02-591-7007 | อีเมล: ${SUPPORT_EMAIL}`
            },
            buttons: {
                home: "กลับสู่หน้าหลัก",
                print: "พิมพ์ใบเสร็จ/ใบสมัคร"
            }
        },
        navigation: {
            next: "ถัดไป",
            back: "ย้อนกลับ",
            saveDraft: "บันทึกร่าง"
        },
        common: {
            errorTitle: "พบข้อผิดพลาด"
        },
        generalStep: {
            applicantTypeHeader: "ประเภทผู้ยื่น",
            typeNames: {
                INDIVIDUAL: "บุคคลธรรมดา",
                COMMUNITY: "วิสาหกิจชุมชน",
                JURISTIC: "นิติบุคคล"
            },
            typeCards: {
                individual: { label: "บุคคลธรรมดา", subLabel: "เกษตรกรรายย่อย" },
                community: { label: "วิสาหกิจชุมชน", subLabel: "กลุ่มเกษตรกร จดทะเบียน สกท." },
                juristic: { label: "นิติบุคคล", subLabel: "บริษัท/ห้างหุ้นส่วน/สหกรณ์" }
            },
            companyTypeOptions: {
                LIMITED_COMPANY: "บริษัทจำกัด",
                LIMITED_PARTNERSHIP: "ห้างหุ้นส่วนจำกัด",
                PUBLIC_LIMITED: "บริษัทมหาชนจำกัด",
                COOPERATIVE: "สหกรณ์การเกษตร",
                OTHER: "อื่น ๆ"
            }
        },
        farmInfo: {
            sections: {
                basic: { title: "1) ข้อมูลพื้นฐานฟาร์ม", subtitle: "กรอกข้อมูลชื่อฟาร์ม ที่อยู่ จังหวัด และพื้นที่รวม" },
                gps: { title: "2) พิกัด GPS ฟาร์ม", subtitle: "ระบุตำแหน่งแปลงปลูกเพื่อการตรวจสอบ" },
                water: { title: "3) ข้อมูลแหล่งน้ำ", subtitle: "ตามมาตรฐาน DTAM" }
            },
            fields: {
                farmName: {
                    label: "ชื่อฟาร์ม/สถานที่เพาะปลูก",
                    placeholder: "เช่น ฟาร์มสมุนไพรบ้านนา",
                    description: "ชื่อนี้จะแสดงในใบรับรอง GACP"
                },
                address: {
                    label: "ที่อยู่",
                    placeholder: "บ้านเลขที่ หมู่ ซอย ถนน"
                },
                province: { label: "จังหวัด", placeholder: "เลือกจังหวัด" },
                district: {
                    label: "อำเภอ/เขต",
                    placeholderEnabled: "เลือกอำเภอ",
                    placeholderDisabled: "กรุณาเลือกจังหวัดก่อน",
                    placeholderText: "พิมพ์ชื่ออำเภอ"
                },
                subdistrict: {
                    label: "ตำบล/แขวง",
                    placeholder: "ระบุตำบล",
                    placeholderEnabled: "เลือกตำบล"
                },
                postalCode: { label: "รหัสไปรษณีย์", placeholder: "00000" },
                totalArea: { label: "พื้นที่รวมทั้งหมด", placeholder: "0" },
                landOwnership: { label: "กรรมสิทธิ์ที่ดิน", description: "ต้องมีเอกสารประกอบ" }
            },
            gps: {
                setBadge: "ระบุแล้ว",
                pickMap: { title: "เลือกจากแผนที่", subtitle: "แนะนำ - แม่นยำที่สุด" },
                currentLocation: {
                    title: "ใช้ตำแหน่งปัจจุบัน",
                    searching: "กำลังค้นหา...",
                    subtitle: "ต้องอยู่ที่ฟาร์ม"
                },
                selected: { title: "พิกัดที่เลือก", editBtn: "แก้ไข" },
                required: "กรุณาระบุพิกัด GPS ของฟาร์ม (บังคับ)"
            },
            water: {
                sourceType: { label: "ประเภทแหล่งน้ำ", placeholder: "เลือกประเภทแหล่งน้ำ" },
                irrigation: { label: "ระบบให้น้ำหลัก (ระดับฟาร์ม)", placeholder: "เลือกระบบให้น้ำ" },
                otherSource: { label: "ระบุแหล่งน้ำอื่น ๆ", placeholder: "เช่น น้ำบาดาลร่วมกับแหล่งน้ำชุมชน" },
                filtration: { label: "ระบบกรองน้ำ (เลือกได้หลายรายการ)" },
                testFile: {
                    label: "ผลตรวจคุณภาพน้ำ (ถ้ามี)",
                    description: "แนบไฟล์รายงานผลตรวจเพื่อประกอบการพิจารณา",
                    placeholder: "เลือกไฟล์ PDF/JPG/PNG"
                }
            }
        },
        qc: {
            headers: {
                main: "การควบคุมคุณภาพ",
                mainSubtitle: "กรอกรายละเอียดการเก็บเกี่ยว การทำแห้ง การบ่ม การจัดเก็บ และมาตรการ GACP",
                harvest: "การเก็บเกี่ยว",
                harvestSubtitle: "ระบุวิธีการเก็บเกี่ยว ระยะความสุก และวิธีตัดแต่ง ตามข้อกำหนด GACP (DTAM หมวด 10)",
                post: "หลังการเก็บเกี่ยว",
                postSubtitle: "การทำแห้ง การบ่ม การจัดเก็บ และบรรจุภัณฑ์ (DTAM หมวด 11-14)",
                gacp: "มาตรการควบคุมคุณภาพ (GACP)",
                gacpSubtitle: "DTAM หมวด 1-3"
            },
            summary: {
                harvestLabel: "การเก็บเกี่ยว",
                storageLabel: "การจัดเก็บ/บรรจุภัณฑ์",
                gacpLabel: "มาตรการ GACP",
                configured: "กำหนดแล้ว",
                notConfigured: "ยังไม่ระบุ",
                items: "ข้อ"
            },
            errorTitle: "ข้อผิดพลาด",
            fields: {
                selectPlaceholder: "เลือก...",
                harvestMethodTitle: "วิธีการเก็บเกี่ยว *",
                maturity: "ระยะความสุกที่เก็บเกี่ยว",
                trim: "วิธีตัดแต่ง",
                dryingMethod: "วิธีทำแห้ง *",
                airflow: "ระบบระบายอากาศ",
                dryDays: "จำนวนวันที่ทำแห้ง",
                dryDaysPlaceholder: "เช่น 7-14",
                dryTemp: "อุณหภูมิ (°C)",
                dryTempPlaceholder: "เช่น 18-25",
                dryHumidity: "ความชื้นสัมพัทธ์ (%RH)",
                dryHumidityPlaceholder: "เช่น 45-55",
                dryDarkRoom: "ทำแห้งในห้องมืด",
                hasCuring: "มีกระบวนการบ่ม (Curing)",
                curingDuration: "ระยะเวลาบ่ม (สัปดาห์)",
                curingDurationPlaceholder: "เช่น 2-8",
                curingTemp: "อุณหภูมิ (°C)",
                curingTempPlaceholder: "เช่น 15-21",
                curingHumidity: "ความชื้น (%RH)",
                curingHumidityPlaceholder: "เช่น 55-65",
                curingContainer: "ภาชนะที่ใช้บ่ม",
                burpFreq: "ความถี่เปิดระบายอากาศ",
                storage: "ระบบจัดเก็บ *",
                storageTempControl: "อุณหภูมิที่ควบคุม (°C)",
                storageTempControlPlaceholder: "เช่น 15-25",
                storageHumidity: "ความชื้นในที่เก็บ (%RH)",
                storageHumidityPlaceholder: "เช่น 45-60",
                packaging: "เลือกประเภทบรรจุภัณฑ์ *",
                packagingOther: "ระบุรายละเอียด",
                packagingOtherPlaceholder: "เช่น ถุงกระดาษเคลือบ, กล่องกระดาษ"
            },
            gacpIntro: "เลือกมาตรการที่ดำเนินการในสถานประกอบการ เพื่อเพิ่มความพร้อมก่อนประเมิน",
            measuresLabel: "มาตรการที่เลือก",
            note: {
                prefix: "หมายเหตุ:",
                body: "ข้อมูลระบบรักษาความปลอดภัย (รั้ว, CCTV, Access Control) กรอกไว้ในขั้นตอน \"ข้อมูลฟาร์ม\" แล้ว"
            }
        },
        documentsStep: {
            uploadStatus: {
                title: "สถานะการอัปโหลดเอกสาร",
                mandatoryBadge: "เอกสารบังคับ",
                completeMessage: "อัปโหลดเอกสารบังคับครบถ้วนแล้ว",
                remainingPrefix: "เหลืออีก",
                remainingSuffix: "รายการ"
            },
            errorBlock: {
                title: "ยังไม่สามารถดำเนินการต่อได้"
            },
            errors: {
                missingType: "ไม่พบประเภทเอกสารที่กำลังอัปโหลด กรุณาลองใหม่อีกครั้ง",
                fileTooLargePrefix: "ไฟล์",
                fileTooLargeSuffix: "มีขนาดเกิน 20 MB กรุณาอัปโหลดไฟล์ที่มีขนาดเล็กลง",
                fileTypePrefix: "ไฟล์",
                fileTypeSuffix: "ไม่ตรงตามรูปแบบที่กำหนด",
                uploadFailed: "อัปโหลดเอกสารไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
                missingMandatoryPrefix: "กรุณาอัปโหลดเอกสารบังคับให้ครบก่อนดำเนินการต่อ",
                missingListPrefix: "เอกสารที่ยังขาด",
                missingMorePrefix: "และอีก",
                missingMoreSuffix: "รายการ"
            },
            tags: {
                required: "บังคับ",
                optional: "ทางเลือก"
            },
            uploaded: {
                success: "อัปโหลดสำเร็จ",
                open: "เปิด",
                remove: "ลบ"
            },
            video: {
                helper: "ใส่ URL วิดีโอจาก YouTube หรือแพลตฟอร์มที่หน่วยงานสามารถเข้าถึงได้",
                placeholder: "https://www.youtube.com/watch?v=..."
            },
            uploadHint: {
                click: "คลิกเพื่ออัปโหลด",
                supports: "รองรับ"
            }
        },
        reviewStep: {
            header: {
                title: "ตรวจทานข้อมูลก่อนยืนยันคำขอ",
                subtitle: "พรีวิวด้านล่างรวบรวมข้อมูลจากทุกขั้นตอนเพื่อให้คุณตรวจสอบความถูกต้องก่อนยืนยันส่งคำขออย่างเป็นทางการ"
            },
            stats: {
                completion: "ความครบถ้วนของคำขอ",
                uploaded: "เอกสารที่อัปโหลดแล้ว",
                fieldCount: "รายการข้อมูลในพรีวิว",
                items: "รายการ"
            },
            checklist: {
                consent: "ข้อมูลความยินยอมและประเภทคำขอ",
                plant: "ข้อมูลพืช วัตถุประสงค์ และวิธีปลูก",
                applicant: "ข้อมูลผู้ยื่นคำขอ",
                farm: "ข้อมูลฟาร์มและแปลงปลูก",
                production: "ข้อมูลการเพาะปลูก",
                quality: "การเก็บเกี่ยวและคุณภาพ",
                documents: "เอกสารประกอบคำขอ"
            },
            snapshot: {
                loading: "กำลังโหลดข้อมูลพรีวิวล่าสุดจากระบบ...",
                errorPrefix: "ไม่สามารถโหลดข้อมูลพรีวิวล่าสุดได้",
                errorFallback: "ไม่สามารถโหลดข้อมูลพรีวิวล่าสุดจากระบบได้",
                retry: "ลองอีกครั้ง"
            },
            canProceed: {
                notReady: "ข้อมูลที่ยังไม่ครบถ้วน กรุณาแก้ไขก่อนยืนยัน",
                fixData: "แก้ไขข้อมูล",
                editAria: "แก้ไขข้อมูล",
                ready: "ข้อมูลครบถ้วน พร้อมเข้าสู่ขั้นตอนยืนยันและส่งคำขอ"
            },
            errors: {
                missingPrefix: "ข้อมูลยังไม่ครบ",
                confirmAll: "กรุณายืนยันเงื่อนไขทั้ง 3 รายการด้านล่างก่อนดำเนินการต่อ",
                preparing: "เกิดข้อผิดพลาดในการเตรียมคำขอ",
                prepareTitle: "เกิดข้อผิดพลาดในการเตรียมคำขอ",
                cannotPrepare: "ไม่สามารถเตรียมคำขอได้",
                retry: "ลองอีกครั้ง"
            },
            confirmCard: {
                title: "ยืนยันและส่งคำขอ",
                subtitle: "โปรดอ่านและยืนยันเงื่อนไขทั้ง 3 รายการก่อนส่งคำขออย่างเป็นทางการ",
                dataCorrect: {
                    title: "ยืนยันว่าข้อมูลและเอกสารถูกต้อง",
                    body: "ข้าพเจ้าตรวจสอบข้อมูลที่กรอกและเอกสารแนบแล้ว และยืนยันว่าเป็นข้อมูลจริง"
                },
                terms: {
                    title: "ยอมรับเงื่อนไขและมาตรฐาน GACP",
                    body: "ข้าพเจ้ารับทราบข้อกำหนดการยื่นคำขอ การตรวจประเมิน และเงื่อนไขตามมาตรฐาน GACP"
                },
                payment: {
                    title: "รับทราบขั้นตอนพรีวิวและการชำระเงิน",
                    body: "หลังจากยืนยัน ระบบจะพาไปหน้าพรีวิวและออกขั้นตอนชำระเงินงวดที่ 1 ก่อนส่งคำขออย่างเป็นทางการ"
                }
            },
            alertProceed: "เมื่อยืนยันแล้ว ระบบจะเตรียมคำขอและพาไปหน้าพรีวิวเพื่อทบทวนรายละเอียดอีกครั้ง ก่อนเข้าสู่ขั้นตอนชำระเงินและการส่งคำขออย่างเป็นทางการ",
            metadata: {
                applicantName: "ชื่อผู้ยื่นคำขอ",
                createdDate: "วันที่สร้างพรีวิว",
                refNumber: "เลขอ้างอิงคำขอ",
                statusLabel: "สถานะการตรวจทาน",
                complete: "ครบถ้วน",
                incomplete: "ยังไม่ครบถ้วน"
            },
            selectionRows: {
                plantType: "ชนิดพืช",
                cultivation: "รูปแบบการปลูก"
            },
            submitNav: {
                submitting: "กำลังเตรียมคำขอ...",
                confirmCta: "ยืนยันและไปหน้าพรีวิว"
            }
        },
        /* Y1-FIX-A — wizard chrome (TH). */
        chrome: {
            stepCounter: "ขั้นตอนที่ {n} จาก {total}",
            tipShow: "แสดงคำแนะนำ",
            tipHide: "ซ่อนคำแนะนำ",
            loadingStep: "กำลังเตรียมข้อมูลขั้นตอน...",
            errorTitle: "เกิดข้อผิดพลาด",
            stepNotFound: "ไม่พบข้อมูลขั้นตอน",
            stepNumberNotFound: "ไม่พบขั้นตอนที่ {n}",
            stepLoadFailed: "ไม่สามารถโหลดข้อมูลขั้นตอนได้",
            stepNotAvailable: "ขั้นตอนนี้ยังไม่พร้อมใช้งาน",
            closeAria: "ปิด",
            headerTitleEdit: "แก้ไขคำขอรับรอง GACP",
            headerTitlePayment: "ขั้นตอนการชำระเงิน",
            headerTitleNew: "ระบบยื่นคำขอรับรอง GACP",
            headerSubtitleStatus: "สถานะ: {label}",
            headerSubtitleForm: "แบบฟอร์มคำขอออนไลน์",
            editBannerTitle: "สิ่งที่ต้องแก้ไข",
            editBannerBadge: "MODE: EDIT"
        },
        /* Y1-FIX-A — per-FLOW_STEP labels (canonical Thai). */
        flowSteps: {
            consent: {
                label: "ยินยอม",
                title: "ยินยอมและประเภทคำขอ",
                description: "ยอมรับหลักเกณฑ์และเลือกประเภทคำขอใบรับรอง"
            },
            plant_selection: {
                label: "ข้อมูลพืช",
                title: "ข้อมูลพืชและสายพันธุ์",
                description: "ระบุประเภทการรับรอง ชนิดพืช สายพันธุ์ และปริมาณ"
            },
            general: {
                label: "ผู้ยื่นคำขอ",
                title: "ข้อมูลผู้ยื่นคำขอ",
                description: "เลือกประเภทผู้ขอและกรอกข้อมูลตามประเภท"
            },
            farm_info: {
                label: "สถานที่ปลูก",
                title: "สถานที่ปลูกและแปลง",
                description: "ระบุที่ตั้งฟาร์ม พิกัด GPS และรายละเอียดแปลงปลูก"
            },
            production_info: {
                label: "การเพาะปลูก",
                title: "การเพาะปลูก",
                description: "ระบุวิธีเพาะปลูก แหล่งพันธุ์ และปัจจัยการผลิต"
            },
            quality_control: {
                label: "เก็บเกี่ยว & คุณภาพ",
                title: "เก็บเกี่ยวและคุณภาพ",
                description: "ระบุวิธีเก็บเกี่ยว การทำแห้ง และมาตรฐานคุณภาพ"
            },
            documents: {
                label: "หลักฐาน",
                title: "หลักฐานประกอบคำขอ",
                description: "อัปโหลดหลักฐานประกอบคำขอตามประเภทผู้ยื่น"
            },
            review: {
                label: "ตรวจทาน",
                title: "ตรวจทานและส่ง",
                description: "ตรวจสอบข้อมูลทั้งหมดก่อนยืนยันส่งคำขอ"
            }
        },
        /* Y1-FIX-A — payment phase step labels (canonical Thai). */
        paymentSteps: {
            invoice: {
                label: "การชำระเงิน",
                title: "ใบเสนอราคาและใบแจ้งหนี้"
            },
            success: {
                label: "ยื่นสำเร็จ",
                title: "สำเร็จ"
            }
        }
    },
};
