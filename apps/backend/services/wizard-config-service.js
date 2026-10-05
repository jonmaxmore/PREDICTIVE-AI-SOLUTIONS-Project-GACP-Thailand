const { prisma } = require('./prisma-database');

/**
 * WizardConfigService
 * API-First configuration for dynamic wizard steps
 */
class WizardConfigService {

    /**
     * Get all enabled steps for a plant type
     * @param {string} plantId - Plant ID (cannabis, kratom, etc.)
     * @returns {Promise<object>} Step configuration
     */
    async getStepConfig(plantId = null) {
        // Determine plant group
        const HIGH_CONTROL_PLANTS = ['cannabis', 'kratom'];
        const plantGroup = HIGH_CONTROL_PLANTS.includes(plantId) ? 'HIGH_CONTROL' : 'GENERAL';

        // Fetch enabled steps
        const steps = await prisma.wizardStepConfig.findMany({
            where: {
                isEnabled: true,
            },
            orderBy: {
                displayOrder: 'asc',
            },
        });

        // Filter by plant group (steps with "*" apply to all)
        const filteredSteps = steps.filter(step => {
            return step.plantGroups.includes('*') || step.plantGroups.includes(plantGroup);
        });

        return {
            steps: filteredSteps.map(step => ({
                stepNumber: step.stepNumber,
                stepKey: step.stepKey,
                titleTH: step.titleTH,
                titleEN: step.titleEN,
                description: step.description,
                icon: step.icon,
                isRequired: step.isRequired,
                componentName: step.componentName,
                validationRules: step.validationRules,
            })),
            totalSteps: filteredSteps.length,
            plantGroup,
        };
    }

    /**
     * Get all steps (for admin)
     */
    async getAllSteps() {
        return prisma.wizardStepConfig.findMany({
            orderBy: { displayOrder: 'asc' },
        });
    }

    /**
     * Update step configuration (admin only)
     * @param {string} stepKey 
     * @param {object} updates 
     */
    async updateStep(stepKey, updates, updatedBy = null) {
        return prisma.wizardStepConfig.update({
            where: { stepKey },
            data: {
                ...updates,
                updatedBy,
                updatedAt: new Date(),
            },
        });
    }

    /**
     * Toggle step enabled/disabled
     * @param {string} stepKey 
     * @param {boolean} isEnabled 
     */
    async toggleStep(stepKey, isEnabled, updatedBy = null) {
        return this.updateStep(stepKey, { isEnabled }, updatedBy);
    }

    /**
     * Seed default 5-step configuration (matching frontend flow)
     * 
     * Current flow:
     * 1. Plant & Applicant - Select plant, service type, purpose, and applicant info
     * 2. Farm Info - Farm address, GPS, plots, water source, security
     * 3. Quality Control - Harvest, drying, storage, IPM, GACP quality checks
     * 4. Documents - Upload GACP required documents
     * 5. Review - Pre-submission checklist and confirmation
     * 
     * Post-submit (payment phase): Quote → Invoice → Success
     */
    async seedDefaultSteps() {
        const defaultSteps = [
            { stepNumber: 1, stepKey: 'plant_selection', titleTH: 'เลือกพืช ผู้ยื่น และวัตถุประสงค์', titleEN: 'Plant & Applicant', icon: 'Leaf', componentName: 'StepPlantSelection', isRequired: true, displayOrder: 1, description: 'เลือกพืช ประเภทบริการ วัตถุประสงค์ รูปแบบการปลูก และข้อมูลผู้ยื่นคำขอ' },
            { stepNumber: 2, stepKey: 'farm_info', titleTH: 'ฟาร์มและแปลงปลูก', titleEN: 'Farm & Plots', icon: 'MapPin', componentName: 'StepFarmInfo', isRequired: true, displayOrder: 2, description: 'ที่อยู่ฟาร์ม พิกัด GPS แปลงปลูก แหล่งน้ำ ระบบรักษาความปลอดภัย' },
            { stepNumber: 3, stepKey: 'quality_control', titleTH: 'คุณภาพ IPM และเก็บเกี่ยว', titleEN: 'Quality Control', icon: 'ShieldCheck', componentName: 'StepQualityControl', isRequired: true, displayOrder: 3, description: 'การเก็บเกี่ยว ทำแห้ง จัดเก็บ บรรจุภัณฑ์ และมาตรการ GACP' },
            { stepNumber: 4, stepKey: 'documents', titleTH: 'เอกสารประกอบ', titleEN: 'Documents', icon: 'Upload', componentName: 'StepDocuments', isRequired: true, displayOrder: 4, description: 'อัปโหลดเอกสารตามข้อกำหนด GACP' },
            { stepNumber: 5, stepKey: 'review', titleTH: 'ตรวจทานและส่งคำขอ', titleEN: 'Review & Submit', icon: 'Eye', componentName: 'StepReview', isRequired: true, displayOrder: 5, description: 'ตรวจสอบความครบถ้วนและยืนยันส่งคำขอ' },
        ];

        for (const step of defaultSteps) {
            await prisma.wizardStepConfig.upsert({
                where: { stepKey: step.stepKey },
                update: step,
                create: {
                    ...step,
                    plantGroups: ['*'], // All plants
                    isEnabled: true,
                },
            });
        }

        return { seeded: defaultSteps.length };
    }
}

module.exports = new WizardConfigService();
