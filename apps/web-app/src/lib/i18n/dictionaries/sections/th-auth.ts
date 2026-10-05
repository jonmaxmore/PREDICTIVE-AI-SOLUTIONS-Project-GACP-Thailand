export const thAuth = {
auth: {
        loginTitle: "เข้าสู่ระบบ",
        registerTitle: "ลงทะเบียน",
        login: {
            title: "เข้าสู่ระบบ GACP",
            subtitle: "จัดการมาตรฐานฟาร์มของคุณได้อย่างราบรื่น",
            placeholder: {
                identifier: "เลขบัตรประชาชน 13 หลัก",
                password: "รหัสผ่าน"
            },
            button: {
                submit: "เข้าสู่ระบบ",
                loading: "กำลังเข้าสู่ระบบ..."
            },
            noAccount: "ยังไม่มีบัญชี?",
            registerLink: "ลงทะเบียน",
            error: {
                invalid: "ข้อมูลไม่ถูกต้อง",
                connection: "เกิดข้อผิดพลาดในการเชื่อมต่อ",
                sessionExpired: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่"
            }
        },
        register: {
            title: "ลงทะเบียน",
            subtitle: "กรอกข้อมูลให้ครบถ้วนเพื่อสร้างบัญชี",
            stepIndicator: "ขั้นตอน {step} / {total}",
            marketing: {
                title: "ลงทะเบียนผู้ประกอบการ\nเข้าสู่ระบบ GACP",
                subtitle: "GACP System Registration",
                desc: "ร่วมเป็นส่วนหนึ่งในการยกระดับสมุนไพรไทย\nเข้าถึงตลาดสากล ด้วยมาตรฐานที่ตรวจสอบได้",
                footer: "Official Registration Portal"
            },
            accountTypes: {
                individual: { label: "บุคคลธรรมดา", subtitle: "เกษตรกรรายย่อย", idLabel: "เลขบัตรประชาชน 13 หลัก", idHint: "1-2345-67890-12-3" },
                juristic: { label: "นิติบุคคล", subtitle: "บริษัท / ห้างหุ้นส่วน", idLabel: "เลขทะเบียนนิติบุคคล 13 หลัก", idHint: "0-1055-12345-67-8" },
                enterprise: { label: "วิสาหกิจชุมชน", subtitle: "กลุ่มเกษตรกร", idLabel: "เลขทะเบียนวิสาหกิจชุมชน", idHint: "XXXX-XXXX-XXX" }
            },
            steps: {
                pdpa: "PDPA",
                account: "บัญชี",
                identity: "ตัวตน",
                personal: "ข้อมูล",
                security: "รหัสผ่าน"
            },
            pdpa: {
                title: "นโยบายความเป็นส่วนตัว",
                accept: "ฉันได้อ่านและยอมรับตามเงื่อนไขที่ระบุข้างต้น",
                acceptHint: "กรุณาเลื่อนอ่านข้อมูลให้จบเพื่อยอมรับเงื่อนไข",
                content: {
                    terms: "ข้อกำหนดและเงื่อนไขการใช้บริการ",
                    intro: "ระบบรับรองมาตรฐาน GACP สมุนไพร (DTAM) มีความจำเป็นต้องเก็บรวบรวมข้อมูลส่วนบุคคลของท่าน เพื่อใช้ในกระบวนการพิจารณารับรองมาตรฐาน GACP Thailand...",
                    collectionTitle: "1. การจัดเก็บข้อมูล",
                    collectionDesc: "เราจัดเก็บข้อมูลชื่อ นามสกุล เลขบัตรประชาชน และพิกัดสถานประกอบการของท่าน...",
                    purposeTitle: "2. วัตถุประสงค์",
                    purposeDesc: "เพื่อระบุตัวตนและยืนยันสิทธิในการถือครองใบรับรองมาตรฐานเกษตรปลอดภัย..."
                }
            },
            form: {
                subtitles: {
                    selectAccount: "เลือกประเภทบัญชีของคุณ",
                    identity: "ยืนยันตัวตน",
                    personal: "ข้อมูลส่วนตัว",
                    juristic: "ข้อมูลสถานประกอบการ",
                    security: "ตั้งรหัสผ่านที่ปลอดภัย"
                },
                fields: {
                    firstName: "ชื่อ",
                    lastName: "นามสกุล",
                    companyName: "ชื่อบริษัท",
                    communityName: "ชื่อวิสาหกิจ",
                    phone: "เบอร์โทรศัพท์ (10 หลัก)",
                    email: "อีเมล (ถ้ามี)",
                    password: "กำหนดรหัสผ่านใหม่",
                    confirmPassword: "ยืนยันรหัสผ่าน",
                    terms: "ข้าพเจ้ายอมรับเงื่อนไขการใช้งานและนโยบายความเป็นส่วนตัว"
                },
                errors: {
                    phoneLength: "กรอกแล้ว {length}/10 หลัก",
                    phoneFormat: "เบอร์ต้องขึ้นต้นด้วย 06, 08, หรือ 09",
                    passwordMismatch: "รหัสผ่านไม่ตรงกัน",
                    general: "เกิดข้อผิดพลาด"
                },
                buttons: {
                    back: "ย้อนกลับ",
                    next: "ดำเนินการต่อ",
                    submit: "ยืนยันลงทะเบียน",
                    login: "เข้าสู่ระบบ",
                    loginLink: "เข้าสู่ระบบที่นี่"
                },
                helpers: {
                    usernameNote: "หมายเลขประจำตัวนี้จะถูกใช้เป็นชื่อผู้ใช้งาน (Username) สำหรับเข้าสู่ระบบ และใช้ในการตรวจสอบสิทธิเบื้องต้น",
                    existingAccount: "มีบัญชีผู้ใช้งานอยู่แล้ว?"
                }
            }
        }
    },
};
