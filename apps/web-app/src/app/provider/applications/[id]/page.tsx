'use client';

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Spinner } from '@/components/ui/spinner';
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Mail,
  Map,
  MapPin,
  Phone,
  Printer,
  User,
  History,
  ShieldCheck,
  ExternalLink,
  Info,
  Inbox,
  UserCheck,
  MessageSquare,
  Lock,
  Send,
} from "lucide-react";

import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives/card';
import {
  NotebookTabs,
  NotebookTabsContent,
  NotebookTabsList,
  NotebookTabsTrigger,
} from '@/components/feature/notebook-tabs';

import ProviderLayout from "../../components/provider-layout";
import { resolveMapViewerUrl } from "@/lib/config/map-tiles";
import { providerApiPaths } from "@/lib/services/provider-api";
import { cn } from "@/lib/utils";
import { apiClient } from '@/lib/api/api-client';
import { toast } from 'sonner';
import { normalizeRole, CANONICAL_ROLES } from '@/lib/constants/canonical-roles';
import { useLanguage } from '@/lib/i18n/language-context';
import { ReviewDecisionModal } from "./review-decision-modal";
import {
  formatDate,
  getSlaDays,
  isRecord,
  pickString,
  statusTone,
  STATUS_BADGE_CLASSES,
  type ApplicationData,
  type ApplicationComment,
  type FormDataRecord,
  type TimelineEntry
} from "./provider-application-detail-config";

import { DocumentsTabPanel } from "./documents-tab-panel";
import { ActivitiesTabPanel } from "./activities-tab-panel";
import { viewerCanActOnReview } from "./review-gate";
import { ApplicationDocumentView } from "@/components/application/application-document-view";
import {
  mapHarvestMethod,
  mapDryingMethod,
  mapStorageSystem,
} from "@/components/application/application-document-helpers";

export default function ProviderApplicationDetailPage() {
  const params = useParams();
  const _router = useRouter();
  const applicationId = String(params?.id || "");
  const { dict } = useLanguage();
  const detailDict = dict.provider?.applicationDetail;

  const [application, setApplication] = useState<ApplicationData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [viewerRole, setViewerRole] = useState<string | null>(null);

  const [reviewAction, setReviewAction] = useState<"approve" | "revision">("approve");
  const [reviewComment, setReviewComment] = useState("");
  const [revisionCategory, setRevisionCategory] = useState("MISSING_DOCUMENT");
  const [revisionItems, setRevisionItems] = useState<string[]>([]);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Wave-3 ERP primitive: per-record chatter composer.
  const [commentDraft, setCommentDraft] = useState("");
  const [commentInternal, setCommentInternal] = useState(false);
  const [isPostingComment, setIsPostingComment] = useState(false);

  useEffect(() => {
    void fetchApplication();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  // DR-2: load viewer role once per mount; renders nothing role-dependent
  // until the canonical role resolves. We deliberately tolerate the
  // network failure path (silently null) — the action panel is gated on
  // an explicit role match below, so an unauthenticated/failed fetch
  // falls through to the read-only branch.
  useEffect(() => {
    let active = true;
    const loadRole = async () => {
      try {
        const res = await apiClient.get<{ role?: string; canonicalRole?: string }>("/auth/provider/me");
        if (active && res.success && res.data) {
          const canonical = normalizeRole(res.data.canonicalRole || res.data.role);
          setViewerRole(canonical);
        }
      } catch {
        // Silently fail — falls through to read-only notice
      }
    };
    void loadRole();
    return () => {
      active = false;
    };
  }, []);

  const fetchApplication = async () => {
    if (!applicationId) return;

    setIsLoading(true);
    try {
      const result = await apiClient.get<ApplicationData>(providerApiPaths.applicationDetail(applicationId));

      if (result?.success && result?.data) {
        setApplication(result.data);
      } else {
        setApplication(null);
      }
    } catch (error: unknown) {
      console.error("[provider-application-detail] load failed", error);
      setApplication(null);
    } finally {
      setIsLoading(false);
    }
  };

  const openReviewModal = (action: "approve" | "revision") => {
    setReviewAction(action);
    setReviewComment("");
    setRevisionCategory("MISSING_DOCUMENT");
    setRevisionItems([]);
    setShowReviewModal(true);
  };

  const submitReview = async () => {
    if (!application) return;

    const cleanedItems = revisionItems.map((item) => item.trim()).filter(Boolean);
    const fullComment =
      reviewAction === "revision"
        ? [
          reviewComment.trim(),
          cleanedItems.length > 0
            ? cleanedItems.map((item, index) => `${index + 1}. ${item}`).join("\n")
            : null,
        ]
          .filter(Boolean)
          .join("\n\n")
        : reviewComment.trim();

    const toState = reviewAction === "approve" ? "DOC_APPROVED" : "REVISION_REQUESTED";

    setIsSubmitting(true);
    try {
      const result = await apiClient.post<unknown>(providerApiPaths.applicationWorkflowTransitions(application.id), {
        toState,
        reasonCode: reviewAction === "approve" ? "DOCUMENTS_APPROVED" : "REVISION_REQUESTED",
        comment: fullComment || null,
        revisionCategory: reviewAction === "revision" ? revisionCategory : null,
        revisionMessage: reviewAction === "revision" ? (reviewComment.trim() || fullComment) : null,
        revisionItems: reviewAction === "revision" ? cleanedItems : [],
        metadata: { source: "provider_applications_detail" },
      });

      if (!result?.success) throw new Error(result?.error || "Unable to submit review decision");

      setShowReviewModal(false);
      await fetchApplication();
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Failed to submit review decision");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Wave-3 chatter: post a staff comment (or internal-only note) on this
  // application. Uses the relative /api proxy (apiClient auto-mints CSRF). On
  // success we append the returned row to the thread + clear the textarea; on
  // error we surface a Thai message. `internalOnly` notes never reach the
  // applicant (backend filters internalOnly:false on applicant reads).
  const submitComment = async () => {
    if (!application) return;
    const content = commentDraft.trim();
    if (!content) {
      toast.error("กรุณากรอกเนื้อหาความคิดเห็นก่อนส่ง");
      return;
    }
    setIsPostingComment(true);
    try {
      const result = await apiClient.post<ApplicationComment>(
        `/api/provider/applications/${encodeURIComponent(application.id)}/comments`,
        { content, internalOnly: commentInternal },
      );
      if (!result?.success || !result?.data) {
        throw new Error(result?.error || "ไม่สามารถบันทึกความคิดเห็นได้");
      }
      setApplication((prev) =>
        prev ? { ...prev, comments: [result.data as ApplicationComment, ...(prev.comments || [])] } : prev,
      );
      setCommentDraft("");
      setCommentInternal(false);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "ไม่สามารถบันทึกความคิดเห็นได้");
    } finally {
      setIsPostingComment(false);
    }
  };

  const status = useMemo(() => statusTone(application?.status), [application]);

  const isReviewableState = useMemo(() => {
    if (!application) return false;
    const workflowState = String(application.formData?.workflowState || "").toUpperCase();
    const statusVal = String(application.status || "").toUpperCase();
    return statusVal === "ASSIGNED_FOR_REVIEW" || workflowState === "ASSIGNED_FOR_REVIEW";
  }, [application]);

  // DR-2: a viewer can act on the panel only when (a) the workflow state
  // allows transition AND (b) their canonical role is in the approve
  // set. SCHEDULER / ACCOUNT_DTAM / ACCOUNT_PLATFORM / ACCOUNT / HEALTH
  // see the read-only notice in the same slot.
  const viewerCanAct = useMemo(() => viewerCanActOnReview(viewerRole), [viewerRole]);

  const canReview = isReviewableState && viewerCanAct;

  // In-place field-edit affordance (V1): the assigned DOCUMENT_REVIEWER or an
  // ADMIN may correct scalar/enum fields while the case is in the reviewer's
  // hands (ASSIGNED_FOR_REVIEW / REVISION_REQUESTED). The backend re-checks
  // assigned-reviewer ownership + state; this only decides whether to expose
  // the edit affordance. `viewerRole` is the normalised (lowercase) canonical
  // role from /auth/provider/me.
  const canEdit = useMemo(() => {
    if (!application) return false;
    const roleOk =
      viewerRole === CANONICAL_ROLES.SYSTEM_ADMIN_DTAM || viewerRole === CANONICAL_ROLES.DOCUMENT_REVIEWER;
    const statusVal = String(application.status || '').toUpperCase();
    const stateOk = statusVal === 'ASSIGNED_FOR_REVIEW' || statusVal === 'REVISION_REQUESTED';
    return roleOk && stateOk;
  }, [application, viewerRole]);

  if (isLoading) {
    return (
      <ProviderLayout title={detailDict?.loadingTitle || 'Loading Application...'}>
        <div className="flex h-[60vh] items-center justify-center">
          <Spinner size="lg" />
        </div>
      </ProviderLayout>
    );
  }

  if (!application) {
    return (
      <ProviderLayout title={detailDict?.notFoundTitle || 'Not Found'}>
        <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
          <AlertTriangle className="h-12 w-12 text-warning" />
          <p className="font-medium text-muted-foreground">{detailDict?.notFoundDescription || 'Application record not found or unauthorized access.'}</p>
          <Button asChild className="rounded-xl">
            <Link href="/provider/applications">{detailDict?.backToList || 'Back to List'}</Link>
          </Button>
        </div>
      </ProviderLayout>
    );
  }

  const health = application.health || application.applicant || {};
  const formData: FormDataRecord = application.formData || {};
  const farmData = isRecord(formData.farmData) ? formData.farmData : {};
  const productionData = isRecord(formData.productionData) ? formData.productionData : {};
  const harvestData = isRecord(formData.harvestData) ? formData.harvestData : {};
  const farmName = pickString(farmData.farmName) !== "-" ? pickString(farmData.farmName) : pickString(formData.farmName);
  const farmAddress = pickString(formData.farmAddress) !== "-" ? pickString(formData.farmAddress) : pickString(farmData.address);
  const plantName = pickString(formData.plantName) !== "-" ? pickString(formData.plantName) : pickString(formData.plantId);
  const cultivationType = pickString(formData.areaType);
  const branchName = pickString(formData.branch) !== "-"
    ? pickString(formData.branch)
    : (pickString(farmData.branch) !== "-" ? pickString(farmData.branch) : pickString(farmData.province));
  const serviceType = pickString(formData.serviceType) !== "-"
    ? pickString(formData.serviceType)
    : pickString(formData.applicationType);
  // Farm coordinates arrive as free-form payload values, so parse before
  // handing them to the map-viewer resolver — it rejects anything non-finite,
  // which is also what "-" from pickString becomes.
  const farmMapViewerUrl = resolveMapViewerUrl(
    Number(pickString(farmData.latitude || farmData.lat || farmData.gpsLat)),
    Number(pickString(farmData.longitude || farmData.lng || farmData.gpsLng)),
  );

  // REV-06/09: Revision request (consumed by the Documents tab)
  const revisionRequest = isRecord(formData.revisionRequest) ? formData.revisionRequest : null;

  const reviewHistory = Array.isArray(formData?.reviewHistory) ? (formData.reviewHistory as TimelineEntry[]) : [];
  const workflowHistory = Array.isArray(application.workflowHistory) ? (application.workflowHistory as TimelineEntry[]) : [];
  const timelineRows: TimelineEntry[] = [...reviewHistory, ...workflowHistory]
    .filter((item) => Boolean(item?.timestamp || item?.date))
    .sort((a, b) => new Date(b?.timestamp || b?.date || 0).getTime() - new Date(a?.timestamp || a?.date || 0).getTime());

  const applicantFullName = `${health.firstName || '-'} ${health.lastName || ''}`.trim();
  const comments: ApplicationComment[] = Array.isArray(application.comments) ? application.comments : [];
  const sla = getSlaDays(application.createdAt);
  const m = detailDict?.metrics;

  // Fiori key-facts strip: compact label/value pairs that sit beneath the
  // object title. Small label above value, tight columns, wraps on narrow.
  const keyFacts: { label: string; value: string; danger?: boolean }[] = [
    { label: m?.status || 'Status', value: status.label },
    { label: m?.slaStatus || 'SLA Status', value: sla.label, danger: sla.danger },
    { label: m?.submitted || 'Submitted', value: formatDate(application.createdAt) },
    { label: 'สาขา/Branch', value: branchName },
    { label: detailDict?.details?.plant || 'Plant', value: plantName },
    { label: 'ประเภทบริการ', value: serviceType },
  ];

  return (
    <ProviderLayout title={detailDict?.title || 'ตรวจสอบคำขอ'} subtitle={detailDict?.subtitle || 'ตรวจสอบความถูกต้องตามระเบียบ'}>
      <div className="animate-fade-in space-y-4">

        {/* ── Fiori object-page header band ──────────────────────────────
            Dense enterprise object header: title (app number) + subtitle
            (applicant · farm), a prominent semantic status badge, a
            compact key-facts strip, and the existing print / back actions. */}
        <section className="rounded-lg border border-border bg-card">
          <div className="flex flex-col gap-3 border-b border-border/60 px-4 py-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="text-[11px] font-semibold text-muted-foreground">
                {detailDict?.eyebrow || 'Compliance Audit'}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-xl font-semibold text-foreground">
                  {application.applicationNumber}
                </h2>
                <span
                  className={cn(
                    'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
                    STATUS_BADGE_CLASSES[status.tone],
                  )}
                  data-testid="object-header-status-badge"
                >
                  {status.label}
                </span>
              </div>
              <p className="truncate text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{applicantFullName || '-'}</span>
                <span className="mx-1.5 text-border">·</span>
                {farmName}
              </p>
              {/* C3 ("งานนี้พาสไปที่ใคร"): show the assigned reviewer + who passed
                  the job + when, sourced from the backend `assignment` block. */}
              <div
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs"
                data-testid="assignment-info"
              >
                <UserCheck className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                {application.assignment?.reviewerId ? (
                  <>
                    <span className="font-medium text-foreground">
                      ผู้ตรวจที่ได้รับมอบหมาย: {application.assignment.reviewerName || '-'}
                    </span>
                    {application.assignment.assignedByName && (
                      <span className="text-muted-foreground">
                        มอบหมายโดย {application.assignment.assignedByName}
                        {application.assignment.assignedAt && (
                          <> · {formatDate(application.assignment.assignedAt)}</>
                        )}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="font-medium text-muted-foreground">ยังไม่ได้มอบหมาย</span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
              <Button asChild variant="outline" size="sm" className="rounded-lg">
                <Link href={`/provider/applications/${applicationId}/print`}>
                  <Printer className="mr-2 h-4 w-4" /> {detailDict?.actions?.print || 'Print Form'}
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="rounded-lg">
                <Link href="/provider/applications">
                  <ArrowLeft className="mr-2 h-4 w-4" /> {detailDict?.actions?.backToList || 'Back to List'}
                </Link>
              </Button>
            </div>
          </div>

          {/* Key-facts strip — small label above value, tight columns. */}
          <dl className="flex flex-wrap gap-x-8 gap-y-3 px-4 py-3">
            {keyFacts.map((fact) => (
              <div key={fact.label} className="min-w-[7rem]">
                <dt className="text-xs text-muted-foreground">
                  {fact.label}
                </dt>
                <dd className={cn(
                  'mt-0.5 truncate text-sm font-medium',
                  fact.danger ? 'text-destructive' : 'text-foreground',
                )}>
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {canReview && (
          <div
            className="flex flex-col items-start justify-between gap-3 rounded-xl border border-secondary/20 bg-secondary/10 p-4 md:flex-row md:items-center"
            data-testid="action-panel-reviewer"
          >
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 shrink-0 text-secondary" aria-hidden="true" />
              <div>
                {/* X2-FIX-A H-1 / Y1-FIX-C: action panel chrome bilingual via dict. */}
                <h3 className="text-xs text-secondary-foreground/70">{detailDict?.actionPanel?.eyebrow || 'รอการดำเนินการ'}</h3>
                <p className="text-sm font-medium text-foreground">{detailDict?.actionPanel?.title || 'รอผลการตรวจ'}</p>
                <p
                  className="mt-0.5 text-xs text-muted-foreground"
                  data-testid="reviewed-steps-hint"
                >
                  {'ตรวจสอบเอกสารแล้วเลือกอนุมัติหรือขอให้แก้ไข'}
                </p>
              </div>
            </div>
            <div className="flex w-full gap-3 md:w-auto">
              {/* X2-FIX-A H-10: Approve / Request-Revision are the
                  highest-stakes decision buttons in the DR workflow;
                  enforce 44×44 touch target (WCAG 2.5.5). The
                  `min-h-[44px] min-w-[44px]` pair guarantees the
                  baseline regardless of which Button size is the
                  primitive default at any point in time. */}
              <Button
                variant="outline"
                className="min-h-[44px] min-w-[44px] flex-1 rounded-lg border-secondary/30 text-secondary hover:bg-secondary/10 md:flex-none"
                onClick={() => openReviewModal("revision")}
                data-testid="action-request-revision"
              >
                {detailDict?.actionPanel?.requestRevision || 'ขอให้แก้ไข'}
              </Button>
              <Button
                className="min-h-[44px] min-w-[44px] flex-1 rounded-lg bg-primary hover:bg-primary/90 md:flex-none"
                onClick={() => openReviewModal("approve")}
                data-testid="action-approve-documents"
              >
                {detailDict?.actionPanel?.approve || 'อนุมัติเอกสาร'}
              </Button>
            </div>
          </div>
        )}

        {/* DR-2: read-only notice for non-reviewer roles when the workflow
            state would otherwise expose action buttons. Renders for
            scheduler / account_dtam / account_platform / account / health
            visitors who reach this URL (e.g. via direct link). The
            backend rejects their transition POST with 400 — we surface
            the same constraint client-side so they don't click and fail.
            We deliberately render even when viewerRole hasn't resolved
            yet AND the role is a known non-reviewer; we render the
            notice only AFTER the role load completes so unauthenticated
            renders don't flash misleading copy. */}
        {isReviewableState && viewerRole && !viewerCanAct && (
          <div
            className="flex flex-col items-start justify-between gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4 md:flex-row md:items-center"
            role="status"
            data-testid="action-panel-readonly-notice"
          >
            <div className="flex items-start gap-3">
              <Info className="mt-0.5 h-5 w-5 text-warning" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-foreground">{detailDict?.readonlyNotice?.title || 'บัญชีของคุณดูได้อย่างเดียว'}</p>
                <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                  {detailDict?.readonlyNotice?.description || 'เฉพาะผู้ตรวจเอกสาร ผู้ตรวจประเมิน หรือผู้ดูแลระบบเท่านั้นที่อนุมัติหรือขอแก้ไขคำขอนี้ได้'}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

          <div className="space-y-4">
            <Card className="overflow-hidden rounded-lg border-border bg-card shadow-none">
              <CardHeader className="border-b border-border/50 bg-muted/30 px-4 py-2.5">
                <CardTitle className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <User className="h-4 w-4 text-primary" /> {detailDict?.sections?.applicant || 'Applicant'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-4">
                <div className="border-b border-border/50 pb-3">
                  <p className="text-base font-medium text-foreground">{`${health.firstName || "-"} ${health.lastName || ""}`.trim()}</p>
                  <Badge tone="neutral" className="mt-1 rounded-md px-2 py-0 text-[11px] font-medium">{health.accountType || "INDIVIDUAL"}</Badge>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-3 text-sm">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <span>{health.phone || "-"}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span>{health.email || "-"}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-lg border-border bg-card shadow-none">
              <CardHeader className="border-b border-border/50 bg-muted/30 px-4 py-2.5">
                <CardTitle className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <MapPin className="h-4 w-4 text-primary" /> {detailDict?.sections?.farmLocation || 'Farm Location'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">{farmName}</p>
                  <p className="mt-1 text-xs font-medium leading-relaxed text-muted-foreground">{farmAddress}</p>
                </div>
                {/* REV-04 was a google.com/maps link carrying the plot's exact
                    coordinates. Every reviewer who opened it handed Google the
                    precise location of a Thai farm together with their own IP.
                    The link now resolves through the operator-configured map
                    viewer (NEXT_PUBLIC_MAP_VIEWER_URL) and simply does not
                    render when none is configured — the latitude/longitude are
                    already shown as text just below. */}
                {farmMapViewerUrl && (
                  <a
                    href={farmMapViewerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 rounded-md py-1 text-sm font-medium text-info hover:underline"
                  >
                    <Map className="h-4 w-4" />
                    {detailDict?.sections?.viewOnMaps || 'เปิดดูแปลงในแผนที่'}
                    <ExternalLink className="ml-auto h-3 w-3" />
                  </a>
                )}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <p className="text-xs text-muted-foreground">{detailDict?.details?.plant || 'Plant'}</p>
                    <p className="text-sm text-foreground">{plantName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">{detailDict?.details?.type || 'Type'}</p>
                    <p className="text-sm text-foreground">{cultivationType}</p>
                  </div>
                  {Boolean(farmData.latitude || farmData.lat || farmData.gpsLat) && (
                    <>
                      <div>
                        <p className="text-xs text-muted-foreground">{detailDict?.details?.latitude || 'Latitude'}</p>
                        <p className="text-sm text-foreground">{pickString(farmData.latitude || farmData.lat || farmData.gpsLat)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{detailDict?.details?.longitude || 'Longitude'}</p>
                        <p className="text-sm text-foreground">{pickString(farmData.longitude || farmData.lng || farmData.gpsLng)}</p>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-2">
            <NotebookTabs defaultValue="overview" className="w-full">
              {/* Wave E.2-E: notebook-style tabs — sections of one
                  application share the same surface visually (tabs
                  merge into the panel below). Fiori: these act as the
                  object-page section anchors. */}
              <NotebookTabsList>
                <NotebookTabsTrigger value="overview">
                  <FileText className="h-4 w-4" /> {detailDict?.tabs?.overview || 'Overview'}
                </NotebookTabsTrigger>
                <NotebookTabsTrigger value="documents">
                  <ExternalLink className="h-4 w-4" /> {detailDict?.tabs?.documents || 'Documents'}
                </NotebookTabsTrigger>
                <NotebookTabsTrigger value="application-document">
                  <FileText className="h-4 w-4" /> เอกสารคำขอ (เต็ม)
                </NotebookTabsTrigger>
                <NotebookTabsTrigger value="activities">
                  <Inbox className="h-4 w-4" /> {detailDict?.tabs?.activities || 'Activities'}
                </NotebookTabsTrigger>
                <NotebookTabsTrigger value="history">
                  <History className="h-4 w-4" /> {detailDict?.tabs?.reviewHistory || 'Review History'}
                </NotebookTabsTrigger>
                <NotebookTabsTrigger value="discussion">
                  <MessageSquare className="h-4 w-4" /> การพูดคุย
                </NotebookTabsTrigger>
              </NotebookTabsList>

              <NotebookTabsContent value="overview" className="animate-fade-in space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Card className="rounded-lg border-border bg-card shadow-none">
                    <CardHeader className="border-b border-border/50 bg-muted/30 px-4 py-2.5">
                      <CardTitle className="text-xs font-medium text-foreground">{detailDict?.sections?.productionPlan || 'Production Plan'}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1 p-4">
                      <DetailRow label={detailDict?.details?.plantCount || 'Plant count'} value={pickString(productionData.plantCount)} />
                      <DetailRow label={detailDict?.details?.estYield || 'Est. yield'} value={pickString(productionData.estimatedYield)} />
                      <DetailRow label={detailDict?.details?.seedSource || 'Seed source'} value={pickString(productionData.seedSource)} />
                    </CardContent>
                  </Card>
                  <Card className="rounded-lg border-border bg-card shadow-none">
                    <CardHeader className="border-b border-border/50 bg-muted/30 px-4 py-2.5">
                      <CardTitle className="text-xs font-medium text-foreground">{detailDict?.sections?.postHarvest || 'Post-Harvest'}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1 p-4">
                      {/* A1: enum values (MANUAL / HANGING / CONTROLLED) → Thai
                          labels via the shared application-document-helpers maps,
                          so the overview summary reads the same Thai wording the
                          applicant chose. Read-only summary; the editable surface
                          is the เอกสารคำขอ(เต็ม) tab. */}
                      <DetailRow label={detailDict?.details?.harvestMethod || 'Harvest method'} value={mapHarvestMethod(harvestData.harvestMethod)} />
                      <DetailRow label={detailDict?.details?.dryingMethod || 'Drying method'} value={mapDryingMethod(harvestData.dryingMethod)} />
                      <DetailRow label={detailDict?.details?.storage || 'Storage'} value={mapStorageSystem(harvestData.storageSystem)} />
                    </CardContent>
                  </Card>
                </div>
              </NotebookTabsContent>

              <NotebookTabsContent value="documents" className="animate-fade-in">
                <DocumentsTabPanel
                  formData={formData}
                  revisionRequest={revisionRequest}
                />
              </NotebookTabsContent>

              {/* Read-only render of the full 9-section applicant document —
                  the same component the applicant preview page uses, so staff
                  see byte-for-byte what the applicant submitted. */}
              <NotebookTabsContent value="application-document" className="animate-fade-in">
                <ApplicationDocumentView
                  application={application}
                  editable={canEdit}
                  onSaved={() => { void fetchApplication(); }}
                />
              </NotebookTabsContent>

              {/* ADR-016 Phase 2: Work activity timeline for this application */}
              <NotebookTabsContent value="activities" className="animate-fade-in space-y-4">
                <ActivitiesTabPanel applicationId={applicationId} />
              </NotebookTabsContent>

              <NotebookTabsContent value="history" className="animate-fade-in">
                <Card className="rounded-lg border-border bg-card p-4 shadow-none">
                  {timelineRows.length > 0 ? (
                    <div className="relative space-y-6 before:absolute before:bottom-2 before:left-[13px] before:top-2 before:w-0.5 before:bg-border">
                      {timelineRows.map((item, index) => {
                        const isApprove = String(item?.action || "").toLowerCase().includes("approve") || String(item?.toState || "").toLowerCase().includes("approve");
                        return (
                          <div key={index} className="relative pl-9">
                            <div className={cn(
                              "absolute left-0 top-0 z-10 flex h-7 w-7 items-center justify-center rounded-full border-4 border-card",
                              isApprove ? "bg-leaf-soft text-leaf-onSoft" : "bg-muted text-muted-foreground"
                            )}>
                              {isApprove ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Info className="h-3.5 w-3.5" />}
                            </div>
                            <div className="space-y-1">
                              <div className="flex items-start justify-between gap-2">
                                <h4 className="text-sm font-medium">{item?.action || item?.toState || (detailDict?.history?.statusUpdated || "Status Updated")}</h4>
                                <span className="shrink-0 text-xs text-muted-foreground">{formatDate(item?.timestamp || item?.date)}</span>
                              </div>
                              <p className="text-sm italic leading-relaxed text-muted-foreground">&quot;{item?.comment || (detailDict?.history?.noComment || "No comment provided.")}&quot;</p>
                              {/* X2-FIX-A H-7: prefer the friendly actor
                                  name when the backend emits it (admin
                                  extension/override handlers do at
                                  admin.js:248/347). Falls back to the
                                  canonical role then the legacy `by`
                                  field then the SYSTEM sentinel — the
                                  canonical `buildWorkflowEvent` does
                                  NOT yet include `actorName`; tracked
                                  as a backend gap in the X2-FIX-A
                                  handoff so the audit-trail attribution
                                  can be completed end-to-end. */}
                              <div className="mt-1.5 flex items-center gap-2">
                                <Badge tone="neutral" className="rounded-md px-2 py-0 text-[11px] font-medium">
                                  {detailDict?.history?.by || 'By'}: {item?.actorName ?? item?.actorRole ?? item?.by ?? (detailDict?.history?.system || "SYSTEM")}
                                </Badge>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-10 text-center font-medium italic text-muted-foreground">{detailDict?.history?.empty || 'No review history records found.'}</div>
                  )}
                </Card>
              </NotebookTabsContent>

              {/* Wave-3 ERP primitive: per-record CHATTER. Staff post comments
                  or internal-only notes here. Internal notes carry a "ภายใน"
                  badge and NEVER reach the applicant (backend filters
                  internalOnly:false on the applicant side). */}
              <NotebookTabsContent value="discussion" className="animate-fade-in space-y-4">
                {/* Composer */}
                <Card className="rounded-lg border-border bg-card shadow-none" data-testid="comment-composer">
                  <CardHeader className="border-b border-border/50 bg-muted/30 px-4 py-2.5">
                    <CardTitle className="flex items-center gap-2 text-xs font-medium text-foreground">
                      <MessageSquare className="h-4 w-4 text-primary" /> เพิ่มความคิดเห็น
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 p-4">
                    <textarea
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      maxLength={5000}
                      rows={3}
                      placeholder="พิมพ์ความคิดเห็นหรือบันทึกภายใน..."
                      data-testid="comment-textarea"
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground" data-testid="comment-internal-toggle">
                        <input
                          type="checkbox"
                          checked={commentInternal}
                          onChange={(e) => setCommentInternal(e.target.checked)}
                          className="h-4 w-4 rounded border-border text-warning focus:ring-warning"
                        />
                        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                        โน้ตภายใน (เจ้าหน้าที่เท่านั้น)
                      </label>
                      <Button
                        onClick={() => { void submitComment(); }}
                        disabled={isPostingComment || !commentDraft.trim()}
                        className="min-h-[44px] rounded-lg bg-primary hover:bg-primary/90"
                        data-testid="comment-submit"
                      >
                        <Send className="mr-2 h-4 w-4" /> {isPostingComment ? 'กำลังส่ง...' : 'ส่งความคิดเห็น'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Thread */}
                <Card className="rounded-lg border-border bg-card p-4 shadow-none" data-testid="comment-thread">
                  {comments.length > 0 ? (
                    <div className="space-y-3">
                      {comments.map((c) => (
                        <div
                          key={c.id}
                          className={cn(
                            'rounded-lg border p-3',
                            c.internalOnly
                              ? 'border-warning/40 bg-warning/10'
                              : 'border-border/60 bg-muted/20',
                          )}
                          data-testid={c.internalOnly ? 'comment-row-internal' : 'comment-row'}
                        >
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            <Badge tone="neutral" className="rounded-md px-2 py-0 text-[11px] font-medium">
                              {c.role || 'PROVIDER'}
                            </Badge>
                            {c.internalOnly && (
                              <Badge tone="warning" className="rounded-md px-2 py-0 text-[11px] font-medium" data-testid="comment-internal-badge">
                                <Lock className="mr-1 h-3 w-3" aria-hidden="true" /> ภายใน
                              </Badge>
                            )}
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                              {formatDate(c.createdAt)}
                            </span>
                          </div>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{c.content}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-10 text-center font-medium italic text-muted-foreground">ยังไม่มีความคิดเห็น</div>
                  )}
                </Card>
              </NotebookTabsContent>
            </NotebookTabs>
          </div>

        </div>
      </div>

      <ReviewDecisionModal
        opened={showReviewModal}
        onClose={() => setShowReviewModal(false)}
        reviewAction={reviewAction}
        reviewComment={reviewComment}
        onReviewCommentChange={setReviewComment}
        revisionCategory={revisionCategory}
        onRevisionCategoryChange={setRevisionCategory}
        revisionItems={revisionItems}
        onAddRevisionItem={() => setRevisionItems([...revisionItems, ""])}
        onUpdateRevisionItem={(index, val) => setRevisionItems(revisionItems.map((v, i) => i === index ? val : v))}
        onRemoveRevisionItem={(index) => setRevisionItems(revisionItems.filter((_, i) => i !== index))}
        onSubmit={submitReview}
        isSubmitting={isSubmitting}
      />
    </ProviderLayout>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/30 py-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}
