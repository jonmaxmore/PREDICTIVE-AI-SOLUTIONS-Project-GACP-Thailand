'use client';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Spinner as Loader } from '@/components/ui/spinner';
import { SimpleGrid } from '@/components/ui/layout-utils';
import { ThemeIcon } from '@/components/ui/icon-buttons';
import { Timeline } from '@/components/ui/data-components';
import {
    NotebookTabs,
    NotebookTabsContent,
    NotebookTabsList,
    NotebookTabsTrigger,
} from '@/components/feature/notebook-tabs';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from 'next/link';
import ProviderLayout from "../../components/provider-layout";
import {
    IconAlertCircle,
    IconArrowLeft,
    IconCheck,
    IconClock,
    IconExternalLink,
    IconFileDescription,
    IconHistory,
    IconMapPin,
    IconPrinter,
    IconSearch,
    IconVideo,
} from "@tabler/icons-react";
import { notifications } from '@/lib/notifications';
import { providerApiPaths } from "@/lib/services/provider-api";
import { useLanguage } from '@/lib/i18n/language-context';
import { getStatusLabel } from "@/lib/constants/workflow-states";
import { AuditApplicationTabPanel } from './audit-application-tab-panel';
import { AuditDecisionModal, type CARFinding } from './audit-decision-modal';
import { AuditRecordTabPanel } from './audit-record-tab-panel';
import { useEvidenceUpload } from './use-evidence-upload';
import { OnlineAuditControl } from './online-audit-control';
import {
    ATTACHMENT_KEYS,
    getApplicantName,
    getRevisionCountdownLabel,
    getRevisionDue,
    providerRequest,
    toDateText,
    type ApplicationData,
    type AuditDecision,
    type AuditTimelineData,
    type AuditorDashboardData,
    type AuditorQueueItem,
} from './provider-audit-job-sheet-config';
export default function ProviderAuditJobSheetPage() {
    const params = useParams();
    const _router = useRouter();
    const applicationId = String(params?.id || "").trim();
    const { dict } = useLanguage();
    const dDict = dict.provider?.audits?.detail;
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [application, setApplication] = useState<ApplicationData | null>(null);
    const [timeline, setTimeline] = useState<AuditTimelineData | null>(null);
    const [queueItem, setQueueItem] = useState<AuditorQueueItem | null>(null);
    const [decisionModalOpened, setDecisionModalOpened] = useState(false);
    const [decision, setDecision] = useState<AuditDecision>("PASS");
    const [decisionNotes, setDecisionNotes] = useState("");
    const {
        evidenceFiles, setEvidenceFiles, isCompressing,
        handleEvidenceUpload, removeEvidence, formatBytes
    } = useEvidenceUpload();
    const [findings, setFindings] = useState<CARFinding[]>([]);
    // Online Audit: duration tracker + live notes
    const [auditStartTime, setAuditStartTime] = useState<number | null>(null);
    const [auditDuration, setAuditDuration] = useState("00:00:00");
    const [liveNotes, setLiveNotes] = useState("");
    const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const fetchData = useCallback(async () => {
        if (!applicationId) {
            return;
        }
        setIsLoading(true);
        try {
            const [applicationResponse, timelineResponse, dashboardResponse] = await Promise.all([
                providerRequest<ApplicationData>(providerApiPaths.applicationDetail(applicationId)),
                providerRequest<AuditTimelineData>(providerApiPaths.applicationAuditTimelines(applicationId)),
                providerRequest<AuditorDashboardData>(providerApiPaths.auditorDashboard("?limit=200")),
            ]);

            if (applicationResponse.success && applicationResponse.data) {
                setApplication(applicationResponse.data);
            } else {
                setApplication(null);
            }

            if (timelineResponse.success && timelineResponse.data) {
                setTimeline(timelineResponse.data);
            } else {
                setTimeline(null);
            }

            if (dashboardResponse.success && dashboardResponse.data) {
                const allItems = [
                    ...dashboardResponse.data.queues.todayUpcoming.items,
                    ...dashboardResponse.data.queues.inProgress.items,
                    ...dashboardResponse.data.queues.followUps.items,
                ];
                const found = allItems.find((item) =>
                    item.applicationId === applicationId
                    || item.id === applicationId
                    || item.applicationNumber === applicationId,
                ) || null;
                setQueueItem(found);
            } else {
                setQueueItem(null);
            }
        } catch (error: unknown) {
            console.error("[audit-job-sheet] load failed:", error);
            notifications.show({
                color: "red",
                title: "โหลดไม่สำเร็จ",
                message: "ไม่สามารถโหลดข้อมูลงานได้",
                icon: <IconAlertCircle size={16} aria-hidden="true" />,
            });
            setApplication(null);
            setTimeline(null);
            setQueueItem(null);
        } finally {
            setIsLoading(false);
        }
    }, [applicationId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // P0-3: restore any online-audit live notes saved locally (once, when the
    // application id resolves) so an unmount/refresh mid-inspection doesn't lose
    // them before the decision is submitted.
    const liveNotesRestored = useRef(false);
    useEffect(() => {
        if (!application?.id || liveNotesRestored.current) {
            return;
        }
        liveNotesRestored.current = true;
        try {
            const saved = localStorage.getItem(`gacp.audit-live-notes.${application.id}`);
            if (saved) {
                setLiveNotes(saved);
            }
        } catch { /* localStorage unavailable — non-fatal */ }
    }, [application?.id]);

    // Mirror live notes to localStorage as the auditor types.
    useEffect(() => {
        if (!application?.id) {
            return;
        }
        try {
            localStorage.setItem(`gacp.audit-live-notes.${application.id}`, liveNotes);
        } catch { /* non-fatal */ }
    }, [liveNotes, application?.id]);

    const formData = useMemo(
        () => (application?.formData || {}) as Record<string, unknown>,
        [application],
    );
    const revisionDueAt = getRevisionDue(formData);
    const revisionCountdown = getRevisionCountdownLabel(revisionDueAt);
    const latestDecision = formData.auditDecision as Record<string, unknown> | undefined;
    const allDecisions = (formData.auditDecisions || []) as Array<Record<string, unknown>>;
    const auditFollowup = (formData.auditFollowup || null) as Record<string, unknown> | null;
    const canStartInspection = !!queueItem?.canStartInspection;
    const canSubmitDecision = !!queueItem?.canSubmitDecision;
    const workflowState = timeline?.application?.workflowState || String(formData.workflowState || "-");
    const isOnlineAudit = queueItem?.inspectionMode === "ONLINE_MEET";

    const startAuditTimer = () => {
        setAuditStartTime(Date.now());
        durationRef.current = setInterval(() => {
            setAuditStartTime((start) => {
                if (!start) return start;
                const elapsed = Math.floor((Date.now() - start) / 1000);
                const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
                const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
                const s = String(elapsed % 60).padStart(2, '0');
                setAuditDuration(`${h}:${m}:${s}`);
                return start;
            });
        }, 1000);
    };

    const stopAuditTimer = () => {
        if (durationRef.current) clearInterval(durationRef.current);
        durationRef.current = null;
        setAuditStartTime(null);
    };

    const attachments = useMemo(() => {
        return ATTACHMENT_KEYS.map((item) => {
            const direct = formData[item.key];
            const nestedDocuments = (formData.documents || {}) as Record<string, unknown>;
            const nestedApplicant = (formData.applicantData || {}) as Record<string, unknown>;
            const url = (direct || nestedDocuments[item.key] || nestedApplicant[item.key]) as string | undefined;
            return {
                ...item,
                url: typeof url === "string" && url.trim() ? url.trim() : null,
            };
        });
    }, [formData]);

    const startInspection = async () => {
        if (!application?.id) {
            return;
        }
        setIsSubmitting(true);
        try {
            const response = await providerRequest(providerApiPaths.auditorStartInspection(application.id), {
                method: "POST",
                body: JSON.stringify({ comment: "เริ่มการตรวจจากใบงาน" }),
            });
            if (!response.success) {
                notifications.show({
                    color: "red",
                    title: "เริ่มตรวจไม่สำเร็จ",
                    message: response.error || "ไม่สามารถเริ่มการตรวจได้",
                    icon: <IconAlertCircle size={16} aria-hidden="true" />,
                });
                return;
            }
            // X2-FIX-B / H-8 — notifications `color` is a Mantine
            // notification stack accent; "teal" was Mantine's success
            // green. The notifications layer maps unknown colors to
            // muted styling, so 'green' is the safe success accent here.
            notifications.show({
                color: "green",
                title: "เริ่มการตรวจแล้ว",
                message: "งานอยู่ในสถานะกำลังตรวจประเมิน",
            });
            await fetchData();
        } finally {
            setIsSubmitting(false);
        }
    };

    const submitDecision = async () => {
        if (!application?.id) {
            return;
        }
        setIsSubmitting(true);
        try {
            const evidencePayload = evidenceFiles.map((evidence) => ({
                type: "photo",
                description: evidence.file.name,
                value: null,
                metadata: {
                    fileName: evidence.file.name,
                    mimeType: evidence.file.type || "application/octet-stream",
                    originalSize: evidence.originalSize,
                    compressedSize: evidence.compressedSize,
                    compressed: true,
                    lastModified: evidence.file.lastModified || null,
                },
            }));

            // P0-3: fold the online-audit live notes into the persisted decision
            // notes so they are NOT silently lost on submit (they were held only in
            // component state and never reached the payload).
            const liveNotesTrimmed = liveNotes.trim();
            const persistedNotes = [
                decisionNotes.trim(),
                liveNotesTrimmed ? `บันทึกระหว่างตรวจออนไลน์\n${liveNotesTrimmed}` : "",
            ].filter(Boolean).join("\n\n");

            const response = await providerRequest(providerApiPaths.auditorDecision(application.id), {
                method: "POST",
                body: JSON.stringify({
                    decision,
                    notes: persistedNotes || undefined,
                    checklist: [],
                    evidence: evidencePayload,
                    findings: findings.filter(f => f.nonConformity.trim() || f.correctiveAction.trim()),
                }),
            });
            if (!response.success) {
                notifications.show({
                    color: "red",
                    title: "บันทึกผลไม่สำเร็จ",
                    message: response.error || "ไม่สามารถส่งผลการตัดสินได้",
                    icon: <IconAlertCircle size={16} aria-hidden="true" />,
                });
                return;
            }
            notifications.show({
                color: "green",
                title: "บันทึกผลการตัดสินแล้ว",
                message: `บันทึกผลการตัดสินเรียบร้อยแล้ว`,
            });
            setDecisionModalOpened(false);
            setDecisionNotes("");
            setLiveNotes("");
            try { localStorage.removeItem(`gacp.audit-live-notes.${application.id}`); } catch { /* non-fatal */ }
            setEvidenceFiles([]);
            setFindings([]);
            await fetchData();
        } finally {
            setIsSubmitting(false);
        }
    };

    if (isLoading) {
        return (
            <ProviderLayout title={dDict?.loadingTitle || "ใบงานตรวจสอบ"} subtitle={dDict?.loadingSubtitle || "กำลังโหลด..."}>
                <div className="flex items-center justify-center">
                    <Loader color="primary" />
                </div>
            </ProviderLayout>
        );
    }

    if (!application) {
        return (
            <ProviderLayout title={dDict?.notFoundTitle || "ใบงานตรวจสอบ"} subtitle={dDict?.notFoundSubtitle || "ไม่พบคำขอ"}>
                <Alert color="red" icon={<IconAlertCircle size={16} aria-hidden="true" />} aria-live="assertive">
                    {dDict?.notFoundMessage || "Unable to load application details for this audit job."}
                </Alert>
                <div className="mt-4 flex flex-wrap items-center">
                    <Button href="/provider/audits" leftSection={<IconArrowLeft size={16} aria-hidden="true" />}>
                        {dDict?.backToDashboard || "Back to Auditor Dashboard"}
                    </Button>
                </div>
            </ProviderLayout>
        );
    }



    return (
        <ProviderLayout title={(dDict?.pageTitle || "ใบงาน {id}").replace('{id}', application.applicationNumber)} subtitle={(dDict?.pageSubtitle || "ผู้ยื่นคำขอ: {applicant}").replace('{applicant}', getApplicantName(application))}>
            {/* Minimal-redesign pass (2026-07-24): this strip used to be a
                full-bleed dark-green gradient block with shadow-xl (the X3-FIX-B
                H-8 brand cue). ProviderLayout already renders the Thai title and
                applicant subtitle directly above it, so the gradient was a second
                competing header carrying no extra information. It is now a plain
                hairline card holding the same status badges, schedule line and
                actions. */}
            <div className="mb-4 rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center">
                    <div className="flex flex-col">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge color="blue">{getStatusLabel(application.status)}</Badge>
                            <Badge tone="primary">{getStatusLabel(workflowState)}</Badge>
                            {queueItem?.inspectionMode && (
                                <Badge color={queueItem.inspectionMode === "ONLINE_MEET" ? "blue" : "grape"}>
                                    {queueItem.inspectionMode === "ONLINE_MEET" ? "ออนไลน์" : "หน้างาน"}
                                </Badge>
                            )}
                            {queueItem && !queueItem.receiptIssued && (
                                <Badge color="orange">
                                    {dDict?.pendingReceipt || "รอใบเสร็จ"}
                                </Badge>
                            )}
                        </div>
                        <p className="text-sm text-muted-foreground">{dDict?.scheduledLabel || "นัดตรวจ:"} {toDateText(queueItem?.scheduledDate || null)}</p>
                        {revisionDueAt && (
                            <div className="flex flex-wrap items-center gap-2">
                                <Badge color={revisionCountdown?.color || "gray"}>
                                    {revisionCountdown?.text || dDict?.revisionDueLabel || "กำหนดส่งฉบับแก้ไข"}
                                </Badge>
                                <p className="text-sm text-muted-foreground">{toDateText(revisionDueAt)}</p>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center">
                        <Button variant="default" leftSection={<IconPrinter size={16} aria-hidden="true" />} onClick={() => window.print()}>
                            {dDict?.print || "พิมพ์"}
                        </Button>
                        {queueItem?.inspectionMode === "ONLINE_MEET" && queueItem.meetingLink && (
                            <Button href={queueItem.meetingLink} target="_blank" leftSection={<IconVideo size={16} aria-hidden="true" />} rightSection={<IconExternalLink size={12} aria-hidden="true" />}>
                                {dDict?.joinMeeting || "เข้าร่วมประชุม"}
                            </Button>
                        )}
                        {queueItem?.inspectionMode === "ONSITE" && queueItem.mapLink && (
                            <Button href={queueItem.mapLink} target="_blank" leftSection={<IconMapPin size={16} aria-hidden="true" />} rightSection={<IconExternalLink size={12} aria-hidden="true" />}>
                                {dDict?.openMap || "เปิดแผนที่"}
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            {/* Wave E.2-E follow-up: notebook-style tabs (form-detail of one
                audit). Migrated from the Mantine-style API (Tabs.List / Tabs.Tab
                / Tabs.Panel) to the explicit Radix-style NotebookTabs. The
                Mantine `leftSection` prop is replaced by inlining the icon as
                first child of the trigger. */}
            {/* X3-FIX-A / H-1 — vocab guidance banner.
                The AUDITOR has two parallel decision flows with different
                vocabularies: the Job Sheet path uses PASS/MINOR/MAJOR
                (document-style CAR taxonomy), while the field-tool
                /inspect path uses PASS/FAIL/NEEDS_REVIEW (onsite triage
                taxonomy). The full unification is architectural (post-
                Loop-X) and requires (1) product decision on canonical
                3-state vs 5-state outcome, (2) backend migration of
                historical decisions, (3) state-machine refactor. For now
                we surface a non-blocking advisory so the auditor picks
                the path that matches the audit type. role="note" — this
                is informational guidance, not an error. */}
            <div
                role="note"
                data-testid="audit-vocab-guidance-banner"
                // Minimal-redesign pass: the 4px amber accent bar is replaced by a
                // hairline border. The advisory amber tone (and its AA-passing
                // amber-900 text) is unchanged — see vocab-guidance-banner.test.tsx.
                className="mb-4 rounded-lg border border-warning/40 bg-amber-50 p-3 text-sm text-amber-900"
            >
                <p>{dDict?.vocabBanner || "การตัดสินใจสามารถบันทึกจากสองทาง"}</p>
            </div>

            <NotebookTabs defaultValue="application">
                <NotebookTabsList>
                    <NotebookTabsTrigger value="application">
                        <IconFileDescription size={16} aria-hidden="true" /> {dDict?.tabs?.application || "ข้อมูลคำขอ"}
                    </NotebookTabsTrigger>
                    <NotebookTabsTrigger value="history">
                        <IconHistory size={16} aria-hidden="true" /> {dDict?.tabs?.history || "ประวัติการตรวจ"}
                    </NotebookTabsTrigger>
                    <NotebookTabsTrigger value="audit">
                        <IconSearch size={16} aria-hidden="true" /> {dDict?.tabs?.audit || "บันทึกการตรวจ"}
                    </NotebookTabsTrigger>
                    {queueItem?.inspectionMode === 'ONSITE' && (
                        <NotebookTabsTrigger value="fieldtools">
                            <IconMapPin size={16} aria-hidden="true" /> {dDict?.tabs?.fieldtools || "เครื่องมือภาคสนาม"}
                        </NotebookTabsTrigger>
                    )}
                </NotebookTabsList>

                <NotebookTabsContent value="application">
                    <AuditApplicationTabPanel
                        application={application}
                        formData={formData}
                        attachments={attachments}
                    />
                </NotebookTabsContent>

                <NotebookTabsContent value="history">
                    <SimpleGrid cols={2} spacing="md">
                        <div className="rounded-lg bg-card p-4 shadow-sm">
                            <div className="mb-3 flex flex-wrap items-center gap-2">
                                <ThemeIcon color="blue"><IconClock size={16} aria-hidden="true" /></ThemeIcon>
                                <p className="font-bold">{dDict?.workflowHistory || "ประวัติเวิร์กโฟลว์"}</p>
                            </div>
                            <Timeline active={(timeline?.workflowHistory || []).length} bulletSize={20} lineWidth={2}>
                                {(timeline?.workflowHistory || []).map((item, index) => {
                                    const comment = typeof item.comment === "string" ? item.comment.trim() : "";
                                    return (
                                        <Timeline.Item
                                            key={`${String(item.timestamp || index)}-${index}`}
                                            title={String(item.action || `${item.fromState || "-"} -> ${item.toState || "-"}`)}
                                        >
                                            <p className="text-xs text-slate-500">{toDateText(String(item.timestamp || ""))}</p>
                                            {comment ? <p className="text-sm">{comment}</p> : null}
                                        </Timeline.Item>
                                    );
                                })}
                            </Timeline>
                            {(timeline?.workflowHistory || []).length === 0 && (
                                <p className="text-sm text-slate-500">ยังไม่มีประวัติเวิร์กโฟลว์</p>
                            )}
                        </div>

                        <div className="rounded-lg bg-card p-4 shadow-sm">
                            <div className="mb-3 flex flex-wrap items-center gap-2">
                                <ThemeIcon color="primary"><IconHistory size={16} aria-hidden="true" /></ThemeIcon>
                                <p className="font-bold">บันทึกการตรวจสอบ</p>
                            </div>
                            <div className="flex flex-col gap-2">
                                {(timeline?.auditLogs || []).slice(-15).reverse().map((log) => (
                                    <div className="rounded-lg bg-card p-3 shadow-sm" key={log.id}>
                                        <div className="flex flex-wrap items-center">
                                            <p className="text-sm font-semibold">{log.action}</p>
                                            <p className="text-xs text-slate-500">{toDateText(log.createdAt)}</p>
                                        </div>
                                        <p className="text-xs text-slate-500">{log.actorRole || "-"} / {log.actorId || "-"}</p>
                                    </div>
                                ))}
                                {(timeline?.auditLogs || []).length === 0 && (
                                    <p className="text-sm text-slate-500">ยังไม่มีบันทึกการตรวจสอบ</p>
                                )}
                            </div>
                        </div>
                    </SimpleGrid>
                </NotebookTabsContent>

                <NotebookTabsContent value="audit">
                    <AuditRecordTabPanel
                        queueItem={queueItem}
                        {...(latestDecision !== undefined ? { latestDecision } : {})}
                        allDecisions={allDecisions}
                        auditFollowup={auditFollowup}
                    />
                </NotebookTabsContent>

                {/* B9 fix: the old field-tools panel (GPS check-in + camera) had no
                    checklist UI and its photo upload FK-violated against the hardened
                    /photo endpoint (Task 9) — it could never certify. ONSITE now gets
                    a single, discoverable entry into the real capture path: the
                    inspect flow. AuditFieldToolsPanel is unmounted here (not deleted —
                    a follow-up may re-wire its GPS tool to the real audit, spec §7.4). */}
                {queueItem?.inspectionMode === 'ONSITE' && (
                    <NotebookTabsContent value="fieldtools">
                        <div className="rounded-lg bg-card p-6 shadow-sm">
                            <div className="mb-3 flex flex-wrap items-center gap-2">
                                <ThemeIcon color="primary"><IconMapPin size={16} aria-hidden="true" /></ThemeIcon>
                                <p className="font-bold">{dDict?.tabs?.fieldtools || 'ตรวจประเมินภาคสนาม'}</p>
                            </div>
                            <p className="mb-4 text-sm text-slate-600">
                                เปิดแอปภาคสนามเพื่อบันทึกพิกัด GPS ถ่ายภาพหลักฐาน ทำแบบตรวจ และตัดสินผล ณ สถานที่จริง
                            </p>
                            <Link
                                href={`/provider/audits/${application.id}/inspect`}
                                data-testid="onsite-inspect-entry"
                                className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-leaf-700 px-6 py-3 text-sm font-bold text-white hover:bg-leaf-800"
                            >
                                เริ่มตรวจประเมินภาคสนาม
                            </Link>
                        </div>
                    </NotebookTabsContent>
                )}
            </NotebookTabs>

            {/* Online Audit Control Center */}
            {isOnlineAudit && (
                <OnlineAuditControl
                    queueItem={queueItem}
                    auditStartTime={auditStartTime}
                    auditDuration={auditDuration}
                    liveNotes={liveNotes}
                    setLiveNotes={setLiveNotes}
                    startAuditTimer={startAuditTimer}
                    stopAuditTimer={stopAuditTimer}
                />
            )}

            {/* Action buttons */}
            <div className="mt-4 rounded-lg bg-card p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between">
                    <p className="text-sm text-slate-500">
                        เลขที่งาน: <span className="font-bold">{application.applicationNumber}</span>
                    </p>
                    {/* DM-1 (V3-C): mobile-first grid for tap-target sizing. On
                        phones we stack to a single column with ≥44px tap
                        height (WCAG 2.5.5). On ≥sm we lay out as a 3-up row
                        for the decision triple; "เริ่มตรวจ" inherits the
                        same grid cell so it doesn't squeeze. */}
                    <div
                        data-testid="auditor-action-buttons"
                        className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3"
                    >
                        {canStartInspection && (
                            <Button onClick={startInspection} loading={isSubmitting} leftSection={<IconCheck size={16} aria-hidden="true" />} className="min-h-[44px] whitespace-normal">
                                เริ่มตรวจ
                            </Button>
                        )}
                        {canSubmitDecision && (
                            <>
                                <Button onClick={() => { setDecision("PASS"); setDecisionModalOpened(true); }} className="min-h-[44px] whitespace-normal">
                                    ผ่าน
                                </Button>
                                <Button color="orange" onClick={() => { setDecision("MINOR"); setDecisionModalOpened(true); }} className="min-h-[44px] whitespace-normal">
                                    ข้อบกพร่องเล็กน้อย (ให้แก้ไข)
                                </Button>
                                <Button color="red" onClick={() => { setDecision("MAJOR"); setDecisionModalOpened(true); }} className="min-h-[44px] whitespace-normal">
                                    ข้อบกพร่องสำคัญ (ให้แก้ไข)
                                </Button>
                                {/* REJECT is not an edge from CAR_REVIEWING (the inspector may only
                                    pass it or send it back with Minor/Major) — the server refuses it
                                    (CAR_REVIEWING_CANNOT_REJECT), so the screen does not offer it. */}
                                {workflowState !== "CAR_REVIEWING" && (
                                    <Button color="dark" onClick={() => { setDecision("REJECT"); setDecisionModalOpened(true); }} className="min-h-[44px] whitespace-normal">
                                        ปฏิเสธคำขอ
                                    </Button>
                                )}
                            </>
                        )}
                    </div>
                </div>
                {!canStartInspection && !canSubmitDecision && (
                    // P0-2: a CAR_PENDING/CAR_REVIEWING app is NOT auditor-actionable
                    // (it's waiting on the applicant's corrective action) — the generic
                    // "cannot act" alert read like a bug. Show a clear waiting state with
                    // the 5-working-day CAR deadline (revisionDueAt now falls back to
                    // carDueAt — see provider-audit-job-sheet-config.ts P0-1).
                    (workflowState === "CAR_PENDING" || workflowState === "CAR_REVIEWING") ? (
                        <Alert color="blue" icon={<IconAlertCircle size={16} aria-hidden="true" />} className="mt-2" aria-live="polite">
                            รอผู้สมัครแก้ไขข้อบกพร่อง ยังตรวจซ้ำไม่ได้จนกว่าผู้สมัครจะส่งการแก้ไข
                            {revisionCountdown ? ` · กำหนดส่งแก้ไข: ${revisionCountdown.text}` : ""}
                        </Alert>
                    ) : (
                        <Alert color="blue" icon={<IconAlertCircle size={16} aria-hidden="true" />} className="mt-2" aria-live="polite">
                            งานนี้ไม่อยู่ในสถานะที่สามารถดำเนินการได้ กรุณาตรวจสอบสถานะใบเสร็จและ Workflow
                        </Alert>
                    )
                )}
            </div>

            <AuditDecisionModal
                opened={decisionModalOpened}
                decision={decision}
                decisionNotes={decisionNotes}
                evidenceFiles={evidenceFiles}
                findings={findings}
                isCompressing={isCompressing}
                isSubmitting={isSubmitting}
                onClose={() => setDecisionModalOpened(false)}
                onDecisionNotesChange={setDecisionNotes}
                onEvidenceUpload={handleEvidenceUpload}
                onRemoveEvidence={removeEvidence}
                onFindingsChange={setFindings}
                formatBytes={formatBytes}
                onSubmit={submitDecision}
            />
        </ProviderLayout>
    );
}
