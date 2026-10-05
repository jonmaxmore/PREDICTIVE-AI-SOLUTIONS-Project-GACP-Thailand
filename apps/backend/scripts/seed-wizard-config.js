const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { prisma } = require('../services/prisma-database');

async function seedWizardConfig() {
    console.log('Seeding Wizard Configuration...\n');
    
    // Delete existing config first
    console.log('Clearing old wizard config...');
    await prisma.wizardStepConfig.deleteMany();
    
    // Correct flow: Submit → Quote → Invoice → Success
    // Steps 1-8 are in database, Steps 9-11 (Quote, Invoice, Success) are handled by frontend EXTENDED_STEPS
    // Fee Structure:
    // - Phase 1: DTAM 5,000 + Platform 500 = 5,500 THB
    // - Phase 2 (after audit): DTAM 25,000 + Platform 2,500 = 27,500 THB
    const defaultSteps = [
        { stepNumber: 1, stepKey: 'plant_selection', titleTH: 'เลือกพืชและประเภทบริการ', titleEN: 'Plant & Service Type', icon: 'Leaf', componentName: 'StepPlantSelection', isRequired: true, displayOrder: 1, description: 'เลือกพืชที่ขอรับรอง รูปแบบการปลูก และประเภทบริการ' },
        { stepNumber: 2, stepKey: 'general_info', titleTH: 'ข้อมูลผู้ยื่นขอ', titleEN: 'Applicant Information', icon: 'User', componentName: 'StepGeneral', isRequired: true, displayOrder: 2, description: 'ข้อมูลบุคคล/วิสาหกิจ/นิติบุคคล พร้อมเอกสาร' },
        { stepNumber: 3, stepKey: 'farm_info', titleTH: 'ข้อมูลฟาร์มและแปลงปลูก', titleEN: 'Farm & Plots', icon: 'MapPin', componentName: 'StepFarmInfo', isRequired: true, displayOrder: 3, description: 'ที่อยู่ฟาร์ม พิกัด GPS แปลงปลูก ระบบรักษาความปลอดภัย' },
        { stepNumber: 4, stepKey: 'production_info', titleTH: 'ข้อมูลการผลิต', titleEN: 'Production Info', icon: 'Factory', componentName: 'StepProductionInfo', isRequired: true, displayOrder: 4, description: 'วิธีการปลูก สายพันธุ์ ปัจจัยการผลิต' },
        { stepNumber: 5, stepKey: 'quality_control', titleTH: 'การควบคุมคุณภาพ', titleEN: 'Quality Control', icon: 'ShieldCheck', componentName: 'StepQualityControl', isRequired: true, displayOrder: 5, description: 'การเก็บเกี่ยว ทำแห้ง จัดเก็บ และควบคุมคุณภาพ' },
        { stepNumber: 6, stepKey: 'documents', titleTH: 'เอกสารประกอบ', titleEN: 'Documents', icon: 'Upload', componentName: 'StepDocuments', isRequired: true, displayOrder: 6, description: 'อัปโหลดเอกสารตามข้อกำหนด GACP' },
        { stepNumber: 7, stepKey: 'review', titleTH: 'ตรวจสอบข้อมูล', titleEN: 'Review', icon: 'Eye', componentName: 'StepReview', isRequired: true, displayOrder: 7, description: 'ตรวจสอบความครบถ้วนก่อนส่งคำขอ' },
        { stepNumber: 8, stepKey: 'submit', titleTH: 'ยืนยันและส่งคำขอ', titleEN: 'Submit', icon: 'Send', componentName: 'StepSubmit', isRequired: true, displayOrder: 8, description: 'ยืนยันส่งคำขอรับรอง GACP' },
    ];

    try {
        for (const step of defaultSteps) {
            await prisma.wizardStepConfig.upsert({
                where: { stepKey: step.stepKey },
                update: step,
                create: {
                    ...step,
                    plantGroups: ['*'],
                    isEnabled: true,
                },
            });
            console.log(`Step ${step.stepNumber}: ${step.stepKey} - ${step.titleTH}`);
        }

        console.log('\n Wizard configuration seeded successfully!');
        console.log('\n New Flow:');
        console.log('  Step 1-7: กรอกข้อมูล');
        console.log('  Step 8: Submit → สร้าง Application');
        console.log('  Step 9: Payment → ชำระเงินงวด 1 (5,000 บาท)');
        console.log('  Step 10: Success');
        console.log('\n Fee Structure:');
        console.log('  งวดที่ 1: 5,000 บาท (ชำระตอนยื่นคำขอ)');
        console.log('  งวดที่ 2: 25,000 บาท (ชำระหลังผ่านการตรวจสอบ)');

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        await prisma.$disconnect();
        process.exit(0);
    }
}

seedWizardConfig();
