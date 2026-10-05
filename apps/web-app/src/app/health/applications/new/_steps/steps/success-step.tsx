'use client';
import { SERVICE_NAME } from '@/lib/pricing/fee-services';

import { Container, SimpleGrid } from '@/components/ui/layout-utils';
import { ThemeIcon } from '@/components/ui/icon-buttons';
import { Timeline } from '@/components/ui/data-components';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { Alert } from '@/components/ui/alert';

import { useApplicationFlowStore } from '../hooks/use-application-flow-store';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api/api-client';
import { Icons } from '@/components/ui/icons';
import { formatThaiDateLong } from '@/utils/thai-date';
import { submissionClaim, LOOKUP_FAILED, type SubmissionClaim } from './submission-claim';

// Wave E.3-E: removed local hardcoded thaiMonths array + formatter.
// Use the canonical formatThaiDateLong from @/utils/thai-date.ts which
// uses Intl.DateTimeFormat('th-TH', ...) — V8 defaults to Buddhist
// calendar for 'th-TH' locale. Output identical: "8 ธันวาคม 2568".

export function StepSuccess() {
    const { state, resetWizard } = useApplicationFlowStore();
    const router = useRouter();

    // What this screen may claim is decided by the server, not by having
    // arrived here. A button on the payment step used to push straight to this
    // route without calling anything, so a farmer was congratulated on filing
    // an application that did not exist. The button is gone; this is what stops
    // a bookmark, a back button or a stale deep link from doing the same.
    const [claim, setClaim] = useState<SubmissionClaim | null>(null);

    useEffect(() => {
        let cancelled = false;
        const applicationId = state.applicationId;

        if (!applicationId) {
            setClaim({ kind: 'not-submitted' });
            return undefined;
        }

        void (async () => {
            try {
                const response = await apiClient.get<{ id?: string; applicationId?: string; status?: string }>(
                    `/applications/${encodeURIComponent(applicationId)}`,
                );
                if (cancelled) return;
                setClaim(submissionClaim({
                    applicationId: response.success ? applicationId : null,
                    status: response.data?.status ?? null,
                }));
            } catch {
                // A failed lookup is not a submission. Saying "we could not
                // check" is the honest answer; claiming success is not.
                if (!cancelled) setClaim(LOOKUP_FAILED);
            }
        })();

        return () => { cancelled = true; };
    }, [state.applicationId]);

    const applicationNo = claim && 'applicationNumber' in claim ? claim.applicationNumber : '-';
    const today = new Date();

    const handleViewApplications = () => {
        resetWizard();
        router.push('/health/applications');
    };

    const handleNewApplication = () => {
        resetWizard();
        router.push('/health/applications/new/step/1');
    };

    const handleGoToDashboard = () => {
        router.push('/health/dashboard');
    };

    if (claim === null) {
        return (
            <Container size="md">
                <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                    กำลังตรวจสอบสถานะคำขอ...
                </div>
            </Container>
        );
    }

    // Nothing was filed, or we could not find out. Either way this screen has
    // nothing to congratulate anyone for.
    if (claim.kind === 'not-submitted' || claim.kind === 'unknown') {
        return (
            <Container size="md">
                <div className="flex flex-col gap-6">
                    <Alert icon={<Icons.AlertCircle size={16} />} color="orange">
                        <h2 className="mb-2 text-base font-semibold text-foreground">
                            {claim.kind === 'unknown'
                                ? 'ไม่สามารถตรวจสอบสถานะคำขอได้'
                                : 'ยังไม่ได้ยื่นคำขอ'}
                        </h2>
                        <p className="text-sm">
                            {claim.kind === 'unknown'
                                ? 'ระบบติดต่อเซิร์ฟเวอร์ไม่สำเร็จ จึงยังยืนยันไม่ได้ว่าคำขอถูกยื่นแล้วหรือไม่ กรุณาลองใหม่อีกครั้ง หรือดูรายการคำขอของท่าน'
                                : `หน้านี้แสดงผลเมื่อยื่นคำขอสำเร็จแล้วเท่านั้น คำขอจะถูกยื่นเมื่อชำระ${SERVICE_NAME.PHASE_1} ในขั้นตอนการชำระเงิน`}
                        </p>
                    </Alert>
                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                        <Button
                            color="green"
                            size="lg"
                            leftSection={<Icons.FileText size={18} />}
                            onClick={handleViewApplications}
                        >
                            ดูคำขอทั้งหมดของฉัน
                        </Button>
                        <Button
                            color="green"
                            size="lg"
                            leftSection={<Icons.Home size={18} />}
                            onClick={handleGoToDashboard}
                        >
                            กลับหน้าหลัก
                        </Button>
                    </SimpleGrid>
                </div>
            </Container>
        );
    }

    // Filed. What may be said beyond that depends on where the money got to,
    // and the accounts team decides that — not this screen.
    const headline = {
        submitted: 'ยื่นคำขอสำเร็จ',
        'awaiting-payment': 'ยื่นคำขอแล้ว รอชำระค่าบริการ',
        closed: 'คำขอนี้สิ้นสุดแล้ว',
    }[claim.kind];

    const subheadline = {
        submitted: `ชำระ${SERVICE_NAME.PHASE_1}เรียบร้อย คำขอเข้าสู่ขั้นตอนตรวจเอกสารแล้ว`,
        'awaiting-payment': `คำขอจะเริ่มเข้าสู่การตรวจสอบเมื่อชำระ${SERVICE_NAME.PHASE_1}แล้ว`,
        closed: 'ดูรายละเอียดเหตุผลได้ที่หน้าคำขอ',
    }[claim.kind];

    const paymentBadge = {
        submitted: { color: 'green', label: 'ชำระแล้ว' },
        'awaiting-payment': { color: 'amber', label: 'รอชำระเงิน' },
        closed: { color: 'zinc', label: 'สิ้นสุด' },
    }[claim.kind];

    return (
        <Container size="md">
            <div className="flex flex-col gap-6">
                {/* Header — announced to screen readers via role="status" */}
                <div
                    role="status"
                    aria-live="polite"
                    className="rounded-lg bg-primary p-6 text-primary-foreground shadow-sm"
                >
                    <div className="flex flex-col gap-4">
                        <ThemeIcon size={80} color="white" className="shadow-lg">
                            <Icons.Check size={48} color="#006633" />
                        </ThemeIcon>
                        <h2 className="text-center text-2xl font-semibold" >{headline}</h2>
                        <p className="text-center text-lg opacity-90 drop-shadow-sm">
                            {subheadline}
                        </p>
                        <Badge size="xl" color="white" className="text-primary shadow-md">
                            เลขที่คำขอ: {applicationNo}
                        </Badge>
                    </div>
                </div>

                {/* Application Summary */}
                <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
                    <h2 className="mb-5 text-base font-semibold text-foreground">
                        <div className="flex flex-wrap items-center gap-3">
                            <ThemeIcon color="green"><Icons.FileText size={20} /></ThemeIcon>
                            สรุปข้อมูลคำขอ
                        </div>
                    </h2>

                    <SimpleGrid cols={2} spacing="lg">
                        <div className="flex flex-col gap-2">
                            <p className="text-sm text-muted-foreground">เลขที่คำขอ</p>
                            <p className="text-lg font-bold">{applicationNo}</p>
                        </div>
                        <div className="flex flex-col gap-2">
                            <p className="text-sm text-muted-foreground">วันที่ยื่นคำขอ</p>
                            <p className="text-lg font-bold">{formatThaiDateLong(today)}</p>
                        </div>
                        <div className="flex flex-col gap-2">
                            <p className="text-sm text-muted-foreground">ผู้ยื่นคำขอ</p>
                            <p className="text-lg font-bold">
                                {state.applicantData?.applicantType === 'INDIVIDUAL'
                                    ? `${state.applicantData?.firstName || ''} ${state.applicantData?.lastName || ''}`
                                    : state.applicantData?.applicantType === 'COMMUNITY'
                                        ? state.applicantData?.communityName
                                        : state.applicantData?.companyName || '-'
                                }
                            </p>
                        </div>
                        <div className="flex flex-col gap-2">
                            <p className="text-sm text-muted-foreground">สถานที่ผลิต</p>
                            <p className="text-lg font-bold">{state.farmData?.farmName || '-'}</p>
                        </div>
                        <div className="flex flex-col gap-2">
                            <p className="text-sm text-muted-foreground">พืชที่ขอรับรอง</p>
                            <p className="text-lg font-bold">{state.plantId?.toUpperCase() || 'CANNABIS'}</p>
                        </div>
                        <div className="flex flex-col gap-2">
                            <p className="text-sm text-muted-foreground">สถานะการชำระเงิน</p>
                            {/* Whatever the server says, not whatever route the
                                user took to get here. */}
                            <Badge color={paymentBadge.color} size="lg">{paymentBadge.label}</Badge>
                        </div>
                    </SimpleGrid>
                </div>

                {/* Next Steps */}
                <div className="rounded-lg border-blue-100 bg-card p-6 shadow-lg">
                    <h2 className="mb-5 text-base font-semibold text-foreground">
                        <div className="flex flex-wrap items-center gap-3">
                            <ThemeIcon color="blue"><Icons.List size={20} /></ThemeIcon>
                            ขั้นตอนถัดไป
                        </div>
                    </h2>

                    <Timeline active={claim.kind === 'submitted' ? 1 : 0} bulletSize={28} lineWidth={2} color="green">
                        <Timeline.Item
                            bullet={<Icons.Check size={14} />}
                            title="ยื่นคำขอ"
                        >
                            <p className="text-sm text-muted-foreground">เสร็จสิ้น - {formatThaiDateLong(today)}</p>
                        </Timeline.Item>

                        <Timeline.Item
                            bullet={<Icons.Search size={14} />}
                            title="ตรวจสอบเอกสารเบื้องต้น"
                            lineVariant="dashed"
                        >
                            <p className="text-sm text-muted-foreground">
                                {claim.kind === 'submitted'
                                    ? 'อยู่ระหว่างดำเนินการ (ประมาณ 7-14 วันทำการ)'
                                    : 'เริ่มเมื่อการชำระเงินได้รับการตรวจสอบแล้ว'}
                            </p>
                        </Timeline.Item>

                        <Timeline.Item
                            bullet={<Icons.Calendar size={14} />}
                            title="นัดหมายตรวจประเมินสถานที่"
                            lineVariant="dashed"
                        >
                            <p className="text-sm text-muted-foreground">เจ้าหน้าที่จะติดต่อนัดหมาย</p>
                        </Timeline.Item>

                        <Timeline.Item
                            bullet={<Icons.Check size={14} />}
                            title="ตรวจประเมินสถานที่"
                            lineVariant="dashed"
                        >
                            <p className="text-sm text-muted-foreground">ผู้ประเมินลงพื้นที่ตรวจสอบ</p>
                        </Timeline.Item>

                        <Timeline.Item
                            bullet={<Icons.Certificate size={14} />}
                            title="รับใบรับรอง GACP"
                            lineVariant="dashed"
                        >
                            <p className="text-sm text-muted-foreground">เมื่อผ่านการประเมิน</p>
                        </Timeline.Item>
                    </Timeline>
                </div>

                {/* Important Notes */}
                <Alert icon={<Icons.Info size={16} />} color="blue">
                    <h2 className="mb-2 text-xs font-semibold text-foreground">คำแนะนำสำคัญ</h2>
                    <div className="flex flex-col gap-2">
                        {claim.kind === 'awaiting-payment' ? (
                            <p className="text-sm font-semibold text-amber-700">• คำขอจะเริ่มเข้าสู่การตรวจสอบเมื่อชำระค่าบริการแล้ว ชำระได้ที่เมนู &quot;คำขอของฉัน&quot;</p>
                        ) : null}
                        <p className="text-sm">• กรุณาเก็บเลขที่คำขอ <span className="font-bold">{applicationNo}</span> ไว้เป็นหลักฐาน</p>
                        <p className="text-sm">• ท่านสามารถติดตามสถานะคำขอได้ที่เมนู &quot;คำขอของฉัน&quot;</p>
                        <p className="text-sm">• หากมีข้อสงสัย กรุณาติดต่อ ระบบรับรองมาตรฐาน GACP สมุนไพร โทร. (02) 5647889</p>
                        <p className="text-sm">• อีเมล: contact@gacpth.com</p>
                    </div>
                </Alert>

                {/* Actions — primary CTA "ดูสถานะใบสมัคร" appears first */}
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                    {state.applicationId && (
                        <Button
                            color="green"
                            size="lg"
                            leftSection={<Icons.Search size={18} />}
                            onClick={() => {
                                router.push(`/health/applications/${state.applicationId}`);
                            }}
                        >
                            ดูสถานะใบสมัคร
                        </Button>
                    )}
                    <Button
                        color="green"
                        size="lg"
                        leftSection={<Icons.FileText size={18} />}
                        onClick={handleViewApplications}
                    >
                        ดูคำขอทั้งหมดของฉัน
                    </Button>
                    <Button
                        color="green"
                        size="lg"
                        leftSection={<Icons.Plus size={18} />}
                        onClick={handleNewApplication}
                    >
                        ยื่นคำขอฉบับใหม่
                    </Button>
                    <Button
                        color="green"
                        size="lg"
                        leftSection={<Icons.Home size={18} />}
                        onClick={handleGoToDashboard}
                    >
                        กลับหน้าหลัก
                    </Button>
                </SimpleGrid>

                {/* Footer */}
                <div className="rounded-lg border-t border-gray-100 bg-card p-4 shadow-sm" style={{ backgroundColor: 'transparent' }} >
                    <div className="flex flex-wrap items-center gap-6">
                        <div className="flex flex-wrap items-center gap-2">
                            <Icons.Phone size={16} color="#666" />
                            <p className="text-sm text-muted-foreground">(02) 5647889</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Icons.Mail size={16} color="#666" />
                            <p className="text-sm text-muted-foreground">contact@gacpth.com</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Icons.Globe size={16} color="#666" />
                            <p className="text-sm text-muted-foreground">ระบบรับรองมาตรฐาน GACP สมุนไพร</p>
                        </div>
                    </div>
                </div>
            </div>
        </Container>
    );
}

export default StepSuccess;
