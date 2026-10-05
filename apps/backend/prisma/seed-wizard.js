const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// 9 wizard steps as shown in UI header "(1/9)"
// Optimized 9-step wizard flow (ไม่มี step ซ้ำซ้อน)
// Step 1 รวม: เลือกพืช + ประเภทบริการ + วัตถุประสงค์ + รูปแบบการปลูก
const WIZARD_STEPS = [
    {
        stepNumber: 1,
        stepKey: 'plant_selection',
        titleTH: 'เลือกพืชและประเภทบริการ',
        titleEN: 'Plant & Service Type',
        description: 'เลือกพืช ประเภทบริการ วัตถุประสงค์ และรูปแบบการปลูก',
        icon: 'Leaf',
        isEnabled: true,
        isRequired: true,
        displayOrder: 1,
        plantGroups: JSON.stringify(["*"]),
        componentName: 'StepPlantSelection',
    },
    {
        stepNumber: 2,
        stepKey: 'general_info',
        titleTH: 'ข้อมูลผู้ยื่นขอ',
        titleEN: 'Applicant Information',
        description: 'ข้อมูลบุคคล/วิสาหกิจ/นิติบุคคล พร้อมเอกสาร',
        icon: 'User',
        isEnabled: true,
        isRequired: true,
        displayOrder: 2,
        plantGroups: JSON.stringify(["*"]),
        componentName: 'StepGeneral',
    },
    {
        stepNumber: 3,
        stepKey: 'farm_info',
        titleTH: 'ข้อมูลฟาร์มและแปลงปลูก',
        titleEN: 'Farm & Plots',
        description: 'ที่อยู่ฟาร์ม พิกัด GPS แปลงปลูก ระบบรักษาความปลอดภัย',
        icon: 'MapPin',
        isEnabled: true,
        isRequired: true,
        displayOrder: 3,
        plantGroups: JSON.stringify(["*"]),
        componentName: 'StepFarmInfo',
    },
    {
        stepNumber: 4,
        stepKey: 'production_info',
        titleTH: 'ข้อมูลการผลิต',
        titleEN: 'Production Info',
        description: 'วิธีการปลูก สายพันธุ์ ปัจจัยการผลิต',
        icon: 'Factory',
        isEnabled: true,
        isRequired: true,
        displayOrder: 4,
        plantGroups: JSON.stringify(["*"]),
        componentName: 'StepProductionInfo',
    },
    {
        stepNumber: 5,
        stepKey: 'quality_control',
        titleTH: 'การควบคุมคุณภาพ',
        titleEN: 'Quality Control',
        description: 'การเก็บเกี่ยว ทำแห้ง จัดเก็บ และควบคุมคุณภาพ',
        icon: 'ShieldCheck',
        isEnabled: true,
        isRequired: true,
        displayOrder: 5,
        plantGroups: JSON.stringify(["*"]),
        componentName: 'StepQualityControl',
    },
    {
        stepNumber: 6,
        stepKey: 'documents',
        titleTH: 'เอกสารประกอบ',
        titleEN: 'Documents',
        description: 'อัปโหลดเอกสารตามข้อกำหนด GACP',
        icon: 'Upload',
        isEnabled: true,
        isRequired: true,
        displayOrder: 6,
        plantGroups: JSON.stringify(["*"]),
        componentName: 'StepDocuments',
    },
    {
        stepNumber: 7,
        stepKey: 'review',
        titleTH: 'ตรวจสอบข้อมูล',
        titleEN: 'Review',
        description: 'ตรวจสอบความครบถ้วนก่อนส่งคำขอ',
        icon: 'Eye',
        isEnabled: true,
        isRequired: true,
        displayOrder: 7,
        plantGroups: JSON.stringify(["*"]),
        componentName: 'StepReview',
    },
    {
        stepNumber: 8,
        stepKey: 'payment',
        titleTH: 'ชำระค่าธรรมเนียม',
        titleEN: 'Payment',
        description: 'ใบเสนอราคาและชำระเงิน',
        icon: 'CreditCard',
        isEnabled: true,
        isRequired: true,
        displayOrder: 8,
        plantGroups: JSON.stringify(["*"]),
        componentName: 'StepInvoice',
    },
    {
        stepNumber: 9,
        stepKey: 'submit',
        titleTH: 'ยืนยันและส่งคำขอ',
        titleEN: 'Submit',
        description: 'ยืนยันส่งคำขอรับรอง GACP',
        icon: 'Send',
        isEnabled: true,
        isRequired: true,
        displayOrder: 9,
        plantGroups: JSON.stringify(["*"]),
        componentName: 'StepSubmit',
    },
];

async function main() {
    console.log('Seeding Wizard Step Configurations...');

    for (const step of WIZARD_STEPS) {
        await prisma.wizardStepConfig.upsert({
            where: { stepNumber: step.stepNumber },
            update: step,
            create: step,
        });
        console.log(`Step ${step.stepNumber}: ${step.titleTH}`);
    }

    console.log('Wizard Step Configuration seeding complete.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
