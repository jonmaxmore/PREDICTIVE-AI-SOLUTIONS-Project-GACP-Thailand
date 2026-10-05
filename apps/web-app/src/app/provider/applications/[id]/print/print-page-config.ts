import { PURPOSE_LICENCE_DOCUMENTS } from '@/lib/certification-purposes';
export interface ApplicationData {
    id: string;
    applicationNumber: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    health?: {
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
        accountType: string;
        idCard?: string;
    };
    applicant: {
        firstName: string;
        lastName: string;
        email: string;
        phone: string;
        accountType: string;
        idCard?: string;
    };
    formData: Record<string, unknown>;
}

export const ALL_DOCUMENTS = [
    { key: 'idCardDoc', name: 'สำเนาบัตรประชาชน' },
    { key: 'houseRegDoc', name: 'สำเนาทะเบียนบ้าน' },
    { key: 'criminalBgDoc', name: 'ผลตรวจประวัติอาชญากรรม' },
    ...PURPOSE_LICENCE_DOCUMENTS,
    { key: 'communityRegDoc', name: 'หนังสือจดทะเบียนวิสาหกิจชุมชน' },
    { key: 'communityMeetingDoc', name: 'รายงานการประชุมวิสาหกิจชุมชน' },
    { key: 'companyRegDoc', name: 'หนังสือรับรองบริษัท/นิติบุคคล' },
    { key: 'directorListDoc', name: 'บัญชีรายชื่อกรรมการ' },
    { key: 'powerOfAttorneyDoc', name: 'หนังสือมอบอำนาจ' },
    { key: 'LAND_TITLE', name: 'เอกสารสิทธิ์ที่ดิน (โฉนด/น.ส.3)' },
    { key: 'RENTAL_CONTRACT', name: 'สัญญาเช่าที่ดิน' },
    { key: 'LAND_CONSENT', name: 'หนังสือยินยอมให้ใช้ที่ดิน' },
    { key: 'SITE_MAP', name: 'แผนที่แสดงที่ตั้งฟาร์ม' },
    { key: 'WATER_TEST', name: 'ผลตรวจคุณภาพน้ำ' },
    { key: 'SOIL_TEST', name: 'ผลตรวจวัสดุปลูก/ดิน' },
    { key: 'EXTERIOR_PHOTOS', name: 'ภาพถ่ายภายนอกอาคาร/โรงเรือน' },
    { key: 'INTERIOR_PHOTOS', name: 'ภาพถ่ายภายในสถานที่ผลิต' },
    { key: 'PRODUCTION_PLAN', name: 'แผนการผลิต' },
    { key: 'SECURITY_PLAN', name: 'มาตรการรักษาความปลอดภัย' },
    { key: 'SOP_MANUAL', name: 'คู่มือ SOP มาตรฐานการปฏิบัติงาน' },
    { key: 'GACP_CERTIFICATE', name: 'หนังสือรับรอง E-learning GACP' },
    { key: 'STRAIN_CERTIFICATE', name: 'หนังสือรับรองสายพันธุ์' },
    { key: 'STAFF_TRAINING', name: 'เอกสารการอบรมพนักงาน' },
    { key: 'VIDEO_LINK', name: 'วิดีโอแสดงการปฏิบัติงาน' },
];

export const PRINT_PAGE_STYLES = `
                @media print {
                    body * {
                        visibility: hidden;
                    }
                    #print-area, #print-area * {
                        visibility: visible;
                    }
                    #print-area {
                        position: absolute;
                        left: 0;
                        top: 0;
                        width: 100%;
                    }
                    .no-print {
                        display: none !important;
                    }
                    @page {
                        size: A4;
                        margin: 15mm;
                    }
                }
            `;
