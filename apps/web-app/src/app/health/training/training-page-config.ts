export interface TrainingRecord {
    id: string;
    farmId: string;
    personName: string;
    personRole?: string;
    trainingTopic: string;
    trainingType: string;
    trainingDate: string;
    trainingHours?: number;
    trainingLocation?: string;
    trainedBy?: string;
    organizerName?: string;
    hasCertificate: boolean;
    certificateNo?: string;
    expiryDate?: string;
    passed: boolean;
    farm?: { farmName: string };
}

export interface Farm {
    id: string;
    farmName: string;
}

export interface TrainingSummary {
    totalRecords: number;
    totalPersonnel: number;
    totalHours: number;
    byType: Record<string, number>;
    expiringSoon: Array<{ personName: string; topic: string; expiryDate: string }>;
}

export const TRAINING_TYPES = [
    { value: 'GACP_BASIC', label: 'หลักสูตร GACP พื้นฐาน', color: 'green' },
    { value: 'HYGIENE', label: 'สุขอนามัยและความปลอดภัย', color: 'blue' },
    { value: 'SAFETY', label: 'ความปลอดภัยในการทำงาน', color: 'orange' },
    { value: 'PESTICIDE', label: 'การใช้สารเคมีอย่างปลอดภัย', color: 'red' },
    { value: 'HARVEST', label: 'การเก็บเกี่ยวและหลังเก็บเกี่ยว', color: 'teal' },
    { value: 'QUALITY', label: 'การควบคุมคุณภาพ', color: 'violet' },
    { value: 'OTHER', label: 'อื่น ๆ', color: 'gray' },
];

export function createDefaultTrainingFormData() {
    return {
        personName: '',
        personRole: '',
        trainingTopic: '',
        trainingType: 'GACP_BASIC',
        trainingDate: new Date(),
        trainingHours: 0,
        trainingLocation: '',
        trainedBy: '',
        organizerName: '',
        hasCertificate: false,
        certificateNo: '',
        expiryDate: null as Date | null,
        passed: true,
        notes: '',
    };
}
