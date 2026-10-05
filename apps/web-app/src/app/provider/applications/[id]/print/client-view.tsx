"use client";
export const dynamic = 'force-dynamic';
import '@/styles/provider-styles.css';
import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/primitives/table';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Spinner } from '@/components/ui/spinner';
import { IconLink } from "@tabler/icons-react";
import { ALL_DOCUMENTS, PRINT_PAGE_STYLES, type ApplicationData } from "./print-page-config";
import { apiClient } from '@/lib/api/api-client';
import { AREA_UNIT_LABEL } from '@/lib/area';
import {
    type ApplicantData,
    type FarmData,
    type HarvestData,
    type PlotItem,
    type PrintFormData,
    type ProductionData,
    type ProviderApplicationResponse as _ProviderApplicationResponse,
} from "./print-page-types";

export default function PrintApplicationPage() {
    const params = useParams();
    const router = useRouter();
    const [data, setData] = useState<ApplicationData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const printRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        fetchApplication();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params.id, router]);
    const fetchApplication = async () => {
        try {
            const result = await apiClient.get<ApplicationData>(`/provider/applications/${params.id}`);
            if (result.success && result.data) {
                setData(result.data);
            }
        } catch (error: unknown) {
            console.error('Error:', error);
        } finally {
            setIsLoading(false);
        }
    };
    const handlePrint = () => {
        window.print();
    };
    if (isLoading) {
        // X2-FIX-B / H-8 — replace Mantine `color="teal"` with brand
        // `color="primary"` (renders `border-primary-500`); aligns the
        // print page loading state with the deep-forest brand primary.
        return <div className="flex items-center justify-center"><Spinner color="primary" size="lg" /></div>;
    }
    if (!data) {
        // X2-FIX-A M-14: announce the empty state to assistive tech.
        // The print page is often opened mid-task (e.g. via a "Print"
        // button) and a silent visual fall-through would leave screen
        // readers without context. role="alert" + an aria-live polite
        // region ensures the failure is announced once the user
        // navigates into the document.
        return (
            <div
                className="flex items-center justify-center"
                role="alert"
                aria-live="polite"
                data-testid="print-not-found-alert"
            >
                <p>ไม่พบข้อมูลคำขอ</p>
            </div>
        );
    }
    const health = data.health || data.applicant;
    const formData = (data.formData ?? {}) as PrintFormData;
    const applicantData: ApplicantData = (formData.applicantData as ApplicantData | undefined) ?? (formData as ApplicantData);
    const farmData: FarmData = (formData.farmData as FarmData | undefined) ?? (formData as FarmData);
    const productionData: ProductionData = (formData.productionData as ProductionData | undefined) ?? {};
    const harvestData: HarvestData = (formData.harvestData as HarvestData | undefined) ?? {};
    const plots: PlotItem[] = Array.isArray(formData?.plots) ? formData.plots as PlotItem[] : [];
    const documents: Record<string, unknown> =
        (formData.documents as Record<string, unknown> | undefined)
        ?? (formData.uploadedDocs as Record<string, unknown> | undefined)
        ?? {};
    // Helper to render a field row
    const renderField = (label: string, value: unknown, fallback: string = '-') => {
        const displayValue = value !== undefined && value !== null && value !== '' ? String(value) : fallback;
        return (
            <TableRow key={label}>
                <TableCell><p className="text-sm font-medium">{label}</p></TableCell>
                <TableCell><p className="text-sm">{displayValue}</p></TableCell>
            </TableRow>
        );
    };
    // Helper to check if document exists
    const hasDoc = (key: string) => {
        return formData?.[key] || documents?.[key] || applicantData?.[key];
    };
    // All possible document types
    return (
        <>
            {/* Print Styles */}
            <style dangerouslySetInnerHTML={{ __html: PRINT_PAGE_STYLES }} />
            {/* Action Bar - Hidden when printing */}
            <div className="no-print print-action-bar p-4">
                <div className="flex flex-wrap items-center">
                    <Button
                        variant="ghost"
                        onClick={() => router.back()}
                    >
                        กลับ
                    </Button>
                    <Button
                        onClick={handlePrint}
                    >
                        พิมพ์เอกสาร
                    </Button>
                </div>
            </div>
            {/* Printable Content */}
            <div className="p-6" id="print-area" ref={printRef}>
                {/* Page 1: Header & Applicant Info */}
                <div className="print-page rounded-lg bg-card p-6 shadow-sm">
                    {/* Header */}
                    <div className="mb-6 text-center">
                        <h2 className="text-xl font-semibold text-slate-900">แบบคำขอรับรองมาตรฐาน GACP</h2>
                        <h2 className="text-lg font-semibold text-slate-900">การปฏิบัติทางการเกษตรที่ดีสำหรับพืชสมุนไพร</h2>
                        <p className="mt-2 text-sm text-slate-500">Good Agricultural and Collection Practices for Medicinal Plants</p>
                    </div>
                    <hr className="my-5 h-px border-0 bg-slate-200/60" />
                    {/* Application Number */}
                    <div className="mb-5 flex flex-wrap items-center">
                        <div>
                            <p className="text-sm text-slate-500">เลขที่คำขอ</p>
                            <p className="text-lg font-bold">{data.applicationNumber}</p>
                        </div>
                        <div className="text-right">
                            <p className="text-sm text-slate-500">วันที่ยื่นคำขอ</p>
                            <p className="text-lg font-medium">{new Date(data.createdAt).toLocaleDateString('th-TH', { dateStyle: 'long' })}</p>
                        </div>
                    </div>
                    <hr className="my-5 h-px border-0 bg-slate-200/60" />
                    {/* Applicant Type */}
                    <Table>
                        <TableBody>
                            <TableRow>
                                <TableCell><p className="font-medium">ประเภทผู้ยื่นคำขอ</p></TableCell>
                                <TableCell>
                                    <Badge color={
                                        applicantData?.applicantType === 'JURISTIC' ? 'blue' :
                                            applicantData?.applicantType === 'COMMUNITY' ? 'grape' : 'gray'
                                    } variant="light">
                                        {applicantData?.applicantType === 'JURISTIC' ? 'นิติบุคคล' :
                                            applicantData?.applicantType === 'COMMUNITY' ? 'วิสาหกิจชุมชน' : 'บุคคลธรรมดา'}
                                    </Badge>
                                </TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                    {/* Individual Applicant */}
                    {(!applicantData?.applicantType || applicantData?.applicantType === 'INDIVIDUAL') && (
                        <Table>
                            <TableBody>
                                {renderField('ชื่อ', applicantData?.firstName || health?.firstName)}
                                {renderField('นามสกุล', applicantData?.lastName || health?.lastName)}
                                {renderField('เลขบัตรประชาชน', applicantData?.idCard || health?.idCard)}
                                {renderField('ที่อยู่', applicantData?.address)}
                                {renderField('จังหวัด', applicantData?.province)}
                                {renderField('อำเภอ/เขต', applicantData?.district)}
                                {renderField('ตำบล/แขวง', applicantData?.subdistrict)}
                                {renderField('รหัสไปรษณีย์', applicantData?.postalCode)}
                                {renderField('หมายเลขโทรศัพท์', applicantData?.phone || health?.phone)}
                                {renderField('อีเมล', applicantData?.email || health?.email)}
                                {renderField('Line ID', applicantData?.lineId)}
                            </TableBody>
                        </Table>
                    )}
                    {/* Community Enterprise */}
                    {applicantData?.applicantType === 'COMMUNITY' && (
                        <>
                            <p className="mb-2 mt-4 font-semibold">ข้อมูลวิสาหกิจชุมชน</p>
                            <Table>
                                <TableBody>
                                    {renderField('ชื่อวิสาหกิจชุมชน', applicantData?.communityName)}
                                    {renderField('เลขทะเบียน สกท.', applicantData?.communityRegNumber)}
                                    {renderField('รหัส ท.ว.ช.3', applicantData?.registrationTVC3)}
                                    {renderField('วันที่จดทะเบียน', applicantData?.communityRegDate)}
                                    {renderField('ที่อยู่วิสาหกิจชุมชน', applicantData?.communityAddress)}
                                    {renderField('จำนวนสมาชิก', applicantData?.memberCount ? `${applicantData.memberCount} คน` : '-')}
                                </TableBody>
                            </Table>
                            <p className="mb-2 font-semibold">ข้อมูลประธานวิสาหกิจชุมชน</p>
                            <Table>
                                <TableBody>
                                    {renderField('ชื่อประธาน', applicantData?.presidentName)}
                                    {renderField('เลขบัตรประชาชนประธาน', applicantData?.presidentIdCard)}
                                    {renderField('โทรศัพท์ประธาน', applicantData?.presidentPhone)}
                                </TableBody>
                            </Table>
                        </>
                    )}
                    {/* Juristic Person */}
                    {applicantData?.applicantType === 'JURISTIC' && (
                        <>
                            <p className="mb-2 mt-4 font-semibold text-blue-600">ข้อมูลนิติบุคคล</p>
                            <Table>
                                <TableBody>
                                    {renderField('ชื่อสถานประกอบการ/บริษัท', applicantData?.companyName)}
                                    {renderField('ประเภทนิติบุคคล', applicantData?.companyType)}
                                    {renderField('เลขทะเบียนนิติบุคคล', applicantData?.registrationNumber)}
                                    {renderField('เลขประจำตัวผู้เสียภาษี', applicantData?.taxId)}
                                    {renderField('ทุนจดทะเบียน', applicantData?.registeredCapital)}
                                    {renderField('ที่อยู่สถานที่จัดตั้ง', applicantData?.companyAddress)}
                                    {renderField('โทรศัพท์สถานประกอบการ', applicantData?.companyPhone)}
                                </TableBody>
                            </Table>
                            <p className="mb-2 font-semibold text-blue-600">ข้อมูลประธานกรรมการ/ผู้มีอำนาจลงนาม</p>
                            <Table>
                                <TableBody>
                                    {renderField('ชื่อประธานกรรมการ', applicantData?.directorName)}
                                    {renderField('ตำแหน่ง', applicantData?.directorPosition)}
                                    {renderField('เลขบัตรประชาชน', applicantData?.directorIdCard)}
                                    {renderField('โทรศัพท์', applicantData?.directorPhone)}
                                    {renderField('อีเมล', applicantData?.directorEmail)}
                                </TableBody>
                            </Table>
                            {(applicantData?.contactName || applicantData?.coordinatorName) && (
                                <>
                                    <p className="mb-2 font-semibold text-blue-600">ข้อมูลผู้ประสานงาน/ผู้ติดต่อ</p>
                                    <Table>
                                        <TableBody>
                                            {renderField('ชื่อผู้ประสานงาน', applicantData?.coordinatorName || applicantData?.contactName)}
                                            {renderField('โทรศัพท์', applicantData?.coordinatorPhone || applicantData?.contactPhone)}
                                            {renderField('อีเมล', applicantData?.contactEmail)}
                                            {renderField('Line ID', applicantData?.coordinatorLineId)}
                                        </TableBody>
                                    </Table>
                                </>
                            )}
                        </>
                    )}
                    <hr className="my-5 h-px border-0 bg-slate-200/60" />
                    {/* Plant Information */}
                    <Table>
                        <TableBody>
                            <TableRow>
                                <TableCell><p className="font-medium">ชนิดพืชสมุนไพร</p></TableCell>
                                <TableCell>
                                    <Badge color="green" variant="light">
                                        {formData?.plantName || formData?.plantId || '-'}
                                    </Badge>
                                </TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell><p className="font-medium">ชื่อวิทยาศาสตร์</p></TableCell>
                                <TableCell><p>{formData?.scientificName || '-'}</p></TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell><p className="font-medium">ส่วนที่ใช้</p></TableCell>
                                <TableCell>{formData?.plantPart || formData?.usedPart || '-'}</TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell><p className="font-medium">วัตถุประสงค์การใช้</p></TableCell>
                                <TableCell>{formData?.purpose || formData?.usePurpose || '-'}</TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </div>
                {/* Page 2: Farm Information */}
                <div className="print-page rounded-lg bg-card p-6 shadow-sm">
                    <h2 className="mb-5 text-base font-semibold text-slate-900">ส่วนที่ 3: ข้อมูลสถานประกอบการ/ฟาร์ม</h2>
                    <Table>
                        <TableBody>
                            {renderField('ชื่อฟาร์ม/สถานประกอบการ', farmData?.farmName)}
                            {renderField('ที่ตั้ง', farmData?.address || farmData?.farmAddress)}
                            {renderField('ตำบล/แขวง', farmData?.subdistrict || farmData?.subDistrict)}
                            {renderField('อำเภอ/เขต', farmData?.district)}
                            {renderField('จังหวัด', farmData?.province)}
                            {renderField('รหัสไปรษณีย์', farmData?.postalCode)}
                            {renderField('พิกัด GPS', farmData?.gpsLat && farmData?.gpsLng ? `${farmData.gpsLat}, ${farmData.gpsLng}` : '-')}
                            {renderField('พื้นที่รวม', farmData?.totalAreaSize ? `${farmData.totalAreaSize} ${AREA_UNIT_LABEL}` : '-')}
                            {renderField('กรรมสิทธิ์ที่ดิน', farmData?.landOwnership === 'OWN' ? 'เจ้าของที่ดิน' : farmData?.landOwnership === 'RENT' ? 'เช่าที่ดิน' : farmData?.landOwnership === 'CONSENT' ? 'ได้รับอนุญาต' : '-')}
                        </TableBody>
                    </Table>
                    {/* Plots */}
                    {plots && plots.length > 0 && (
                        <>
                            <h2 className="mb-3 text-sm font-semibold text-green-700 text-slate-900">รายละเอียดแปลงปลูก ({plots.length} แปลง)</h2>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>#</TableHead>
                                        <TableHead>ชื่อแปลง</TableHead>
                                        <TableHead>พื้นที่</TableHead>
                                        <TableHead>ประเภท</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {plots.map((plot, i: number) => (
                                        <TableRow key={plot.id || i}>
                                            <TableCell>{i + 1}</TableCell>
                                            <TableCell>{plot.name || `แปลงที่ ${i + 1}`}</TableCell>
                                            <TableCell>{plot.areaSize} {AREA_UNIT_LABEL}</TableCell>
                                            <TableCell>
                                                <Badge variant="light" color={plot.solarSystem === 'INDOOR' ? 'grape' : plot.solarSystem === 'GREENHOUSE' ? 'blue' : 'green'}>
                                                    {plot.solarSystem === 'INDOOR' ? 'ในร่ม' : plot.solarSystem === 'GREENHOUSE' ? 'โรงเรือน' : 'กลางแจ้ง'}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </>
                    )}
                    {/* Infrastructure */}
                    <h2 className="mb-3 text-sm font-semibold text-slate-900">โครงสร้างพื้นฐานและความปลอดภัย</h2>
                    <Table>
                        <TableBody>
                            {renderField('แหล่งน้ำ', farmData?.waterSource)}
                            {renderField('แหล่งไฟฟ้า', farmData?.electricitySource)}
                            {renderField('ประเภทดิน', farmData?.soilType)}
                            {renderField('ค่า pH ดิน', farmData?.soilPH)}
                            <TableRow>
                                <TableCell><p className="text-sm font-medium">ระบบรักษาความปลอดภัย</p></TableCell>
                                <TableCell>
                                    <div className="flex flex-wrap items-center gap-2">
                                        {farmData?.hasFence && <Badge variant="light" tone="primary">รั้วล้อมรอบ</Badge>}
                                        {farmData?.hasCCTV && <Badge variant="light" tone="primary">กล้องวงจรปิด</Badge>}
                                        {farmData?.hasAccessControl && <Badge variant="light" tone="primary">ระบบควบคุมการเข้า-ออก</Badge>}
                                        {farmData?.hasWarningSign && <Badge variant="light" tone="primary">ป้ายเตือน</Badge>}
                                        {!farmData?.hasFence && !farmData?.hasCCTV && !farmData?.hasAccessControl && !farmData?.hasWarningSign && <p className="text-sm text-slate-500">-</p>}
                                    </div>
                                </TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                    <h2 className="mb-5 text-base font-semibold text-slate-900">ส่วนที่ 4: ข้อมูลการผลิต</h2>
                    <Table>
                        <TableBody>
                            {renderField('ส่วนของพืชที่ใช้', Array.isArray(productionData?.plantParts) ? productionData.plantParts.join(', ') : productionData?.plantParts)}
                            {renderField('วิธีการขยายพันธุ์', Array.isArray(productionData?.propagationType) ? productionData.propagationType.join(', ') : productionData?.propagationType)}
                            {renderField('ชื่อสายพันธุ์', productionData?.varietyName)}
                            {renderField('แหล่งเมล็ดพันธุ์', productionData?.seedSource || productionData?.sourceType)}
                            {renderField('พื้นที่เพาะปลูก', productionData?.cultivationArea)}
                            {renderField('ระยะห่างปลูก', productionData?.spacing)}
                            {renderField('จำนวนต้น', productionData?.plantCount)}
                            {renderField('ผลผลิตที่คาดหวัง', productionData?.estimatedYield)}
                        </TableBody>
                    </Table>
                </div>
                {/* Page 3: Processing & Documents */}
                <div className="print-page rounded-lg bg-card p-6 shadow-sm">
                    <h2 className="mb-5 text-base font-semibold text-slate-900">ส่วนที่ 5: การเก็บเกี่ยวและจัดการหลังเก็บเกี่ยว</h2>
                    <Table>
                        <TableBody>
                            {renderField('วิธีการเก็บเกี่ยว', harvestData?.harvestMethod || formData?.harvestMethod)}
                            {renderField('วิธีการลดความชื้น/ทำแห้ง', harvestData?.dryingMethod || formData?.dryingMethod)}
                            {renderField('รายละเอียดการทำแห้ง', harvestData?.dryingDetail || formData?.dryingDetail)}
                            {renderField('สถานที่เก็บรักษา', harvestData?.storageSystem || formData?.storageSystem || formData?.storageMethod)}
                            {renderField('บรรจุภัณฑ์', harvestData?.packaging || formData?.packaging || formData?.packagingMethod)}
                        </TableBody>
                    </Table>
                    <h2 className="mb-5 text-base font-semibold text-slate-900">ส่วนที่ 6: เอกสารประกอบการยื่นคำขอ</h2>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>#</TableHead>
                                <TableHead>รายการเอกสาร</TableHead>
                                <TableHead>สถานะ</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {ALL_DOCUMENTS.map((doc, i) => (
                                <TableRow key={doc.key}>
                                    <TableCell>{i + 1}</TableCell>
                                    <TableCell><p className="text-sm">{doc.name}</p></TableCell>
                                    <TableCell>
                                        {hasDoc(doc.key) ? (
                                            <Badge tone="primary" variant="light">
                                                แนบแล้ว
                                            </Badge>
                                        ) : (
                                            <Badge color="gray" variant="light">
                                                -
                                            </Badge>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    {(formData?.youtubeUrl || formData?.videoLink) && (
                        <div className="print-video-section mt-5 p-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <IconLink size={18} />
                                <p className="font-medium">วิดีโอแสดงการปฏิบัติงาน:</p>
                            </div>
                            <p className="mt-2 text-sm text-blue-600">{formData.youtubeUrl || formData.videoLink}</p>
                        </div>
                    )}
                </div>
                {/* Page 4: Declaration & Signature */}
                <div className="print-page-last rounded-lg bg-card p-6 shadow-sm">
                    <h2 className="mb-5 text-base font-semibold text-slate-900">ส่วนที่ 7: คำรับรองของผู้ยื่นคำขอ</h2>
                    <div className="print-declaration-box mb-6 p-5">
                        <p className="mb-4 text-sm">
                            ข้าพเจ้าขอรับรองว่าข้อมูลทั้งหมดที่ระบุในแบบคำขอนี้เป็นความจริงทุกประการ
                            และข้าพเจ้ายินยอมให้เจ้าหน้าที่เข้าตรวจสอบพื้นที่ปลูกและเอกสารที่เกี่ยวข้องได้
                        </p>
                        <p className="text-sm">
                            หากข้อมูลใดไม่ตรงกับความเป็นจริง ข้าพเจ้ายินยอมรับผิดชอบตามกฎหมายที่เกี่ยวข้อง
                            และยินยอมให้ยกเลิกการรับรองที่ได้รับ
                        </p>
                    </div>
                    <div className="grid gap-4">
                        <div>
                            <div className="flex flex-col gap-2">
                                <div className="print-signature-line" />
                                <p className="text-sm">ลงชื่อ ผู้ยื่นคำขอ</p>
                                <p className="text-sm text-slate-500">({health?.firstName} {health?.lastName})</p>
                                <p className="text-sm text-slate-500">วันที่ ........../........../...........</p>
                            </div>
                        </div>
                        <div>
                            <div className="flex flex-col gap-2">
                                <div className="print-signature-line" />
                                <p className="text-sm">ลงชื่อ เจ้าหน้าที่รับคำขอ</p>
                                <p className="text-sm text-slate-500">(..........................................)</p>
                                <p className="text-sm text-slate-500">วันที่ ........../........../...........</p>
                            </div>
                        </div>
                    </div>
                    <hr className="h-px border-0 bg-slate-200/60" />
                    <h2 className="mb-5 text-base font-semibold text-slate-900">สำหรับเจ้าหน้าที่</h2>
                    <Table>
                        <TableBody>
                            <TableRow>
                                <TableCell><p className="font-medium">ผลการตรวจสอบเอกสาร</p></TableCell>
                                <TableCell>
                                    <div className="flex flex-wrap items-center">
                                        <div className="print-checkbox" /> ครบถ้วน
                                        <div className="print-checkbox ml-4" /> ไม่ครบถ้วน
                                    </div>
                                </TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell><p className="font-medium">ความเห็นเจ้าหน้าที่</p></TableCell>
                                <TableCell></TableCell>
                            </TableRow>
                            <TableRow>
                                <TableCell><p className="font-medium">วันที่นัดตรวจประเมิน</p></TableCell>
                                <TableCell></TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                    <div className="flex flex-wrap items-center">
                        <div className="flex flex-col gap-2">
                            <div className="print-signature-line" />
                            <p className="text-sm">ลงชื่อ ผู้ตรวจสอบ</p>
                            <p className="text-sm text-slate-500">(..........................................)</p>
                            <p className="text-sm text-slate-500">วันที่ ........../........../...........</p>
                        </div>
                    </div>
                    {/* Footer */}
                    <div className="print-footer pt-5 text-center">
                        <p className="text-xs text-slate-500">
                            แบบคำขอรับรองมาตรฐาน GACP | ระบบรับรองมาตรฐาน GACP สมุนไพร GACP Thai Platform
                        </p>
                        <p className="text-xs text-slate-500">
                            เลขที่คำขอ: {data.applicationNumber} | พิมพ์เมื่อ: {new Date().toLocaleString('th-TH')}
                        </p>
                    </div>
                </div>
            </div>
        </>
    );
}
