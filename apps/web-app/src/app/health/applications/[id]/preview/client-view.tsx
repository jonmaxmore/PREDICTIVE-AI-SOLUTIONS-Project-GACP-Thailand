"use client";

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { apiClient as api } from '@/lib/api';
import { HEALTH_LOGIN_ROUTE } from '@/lib/constants/auth-routes';
import { Badge } from '@/components/ui/primitives/badge';
import { Button } from '@/components/ui/primitives/button';
import { PageSkeleton } from '@/components/ui/page-skeleton';
import { Icons } from '@/components/ui/icons';
import {
  getStoredAccessToken,
  getStoredUser,
} from '@/lib/services/auth-service-session';
import {
  formatDate,
  type ApplicationData,
  withFallback,
} from './preview-page-helpers';

export default function ApplicationPreviewPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params?.id || '');

  const [application, setApplication] = useState<ApplicationData | null>(null);
  // The ministry's own form, assembled server-side by the ONE renderer that also
  // produces the PDF (services/pdf/katorlor1-template-service). This page used to
  // show ApplicationDocumentView — a layout the platform invented — so what a
  // farmer reviewed and what the department received were two different documents.
  const [katorlor1Html, setKatorlor1Html] = useState<string | null>(null);
  const [katorlor1Error, setKatorlor1Error] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  // Separate from `error`: a failed PDF download must NOT blank the whole
  // preview (that page-level error card is only for load failures).
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    if (!getStoredUser()) {
      router.replace(HEALTH_LOGIN_ROUTE);
      return;
    }

    if (!id || id === 'undefined') {
      void fetchLatestApplication();
      return;
    }

    void loadApplication(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function fetchLatestApplication() {
    setLoading(true);
    setError(null);

    try {
      const result = await api.get<
        { data?: Array<{ id?: string }> } | Array<{ id?: string }>
      >('/applications/my');

      if (!result.success || !result.data) {
        setError('ไม่พบรายการคำขอของผู้ใช้งาน');
        return;
      }

      const applications = Array.isArray(result.data) ? result.data : result.data.data || [];
      if (applications.length === 0) {
        setError('ไม่พบรายการคำขอของผู้ใช้งาน');
        return;
      }

      const latest = applications[0];
      if (!latest) {
        setError('ไม่พบรายการคำขอของผู้ใช้งาน');
        return;
      }
      const latestId = latest.id || latest.id;
      if (!latestId) {
        setError('ไม่พบรหัสคำขอล่าสุด');
        return;
      }

      router.replace(`/health/applications/${latestId}/preview`);
    } catch {
      setError('เกิดข้อผิดพลาดในการโหลดข้อมูลคำขอ');
    } finally {
      setLoading(false);
    }
  }

  async function loadApplication(applicationId: string) {
    setLoading(true);
    setError(null);

    try {
      const result = await api.get<ApplicationData>(`/applications/${applicationId}`);
      if (!result.success || !result.data) {
        setError(result.error || 'ไม่พบข้อมูลคำขอ');
        return;
      }

      setApplication(result.data);
      void loadKatorlor1(applicationId);
    } catch {
      setError('เกิดข้อผิดพลาดในการโหลดข้อมูลคำขอ');
    } finally {
      setLoading(false);
    }
  }

  /**
   * The assembled form.
   *
   * A failure here never falls back to a locally-drawn substitute: the whole
   * point is that this page shows the SAME document the department receives, so
   * "we could not assemble your form" is the honest answer and an invented layout
   * standing in for it is not.
   */
  async function loadKatorlor1(applicationId: string) {
    try {
      const result = await api.get<{ html?: string }>(`/applications/${applicationId}/katorlor1`);
      if (!result.success || !result.data?.html) {
        setKatorlor1Error('ระบบประกอบแบบ กทล.1 ของคำขอนี้ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
        return;
      }
      setKatorlor1Html(result.data.html);
      setKatorlor1Error(null);
    } catch {
      setKatorlor1Error('ระบบประกอบแบบ กทล.1 ของคำขอนี้ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    }
  }

  function handlePrint() {
    window.print();
  }

  async function handleDownloadPdf() {
    if (!id || downloading) return;

    setDownloading(true);
    setDownloadError(null);
    try {
      const token = getStoredAccessToken();

      // Use the relative `/api/*` proxy path (same as apiClient) — NOT
      // NEXT_PUBLIC_API_URL, which on staging/prod is the site ORIGIN with no
      // `/api` segment, so `${NEXT_PUBLIC_API_URL}/applications/..` resolved to
      // `https://host/applications/..` → 404 → "ดาวน์โหลด PDF ไม่สำเร็จ" (2026-06-25).
      const response = await fetch(`/api/applications/${id}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('download-failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `Application-${application?.applicationNumber || id}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setDownloadError('ดาวน์โหลด PDF ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return <PageSkeleton type="detail" />;
  }

  if (error || !application) {
    return (
      <section className="surface-panel p-6 sm:p-7">
        <div className="mx-auto max-w-xl text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-red-50 text-red-600">
            <Icons.AlertCircle size={20} />
          </div>
          <h2 className="text-lg font-semibold text-foreground">ไม่สามารถแสดงตัวอย่างคำขอได้</h2>
          <p className="mt-1 text-sm text-muted-foreground">{error || 'ไม่พบข้อมูลคำขอ'}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button href="/health/applications" variant="secondary">
              กลับหน้ารายการคำขอ
            </Button>
            <Button href="/health/applications/new" variant="outline">
              ยื่นคำขอใหม่
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="flow-stack-lg print:print-color-exact pb-4">
      <section className="surface-panel p-5 sm:p-6 print:hidden" data-print-hide="true">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <Button
              href={`/health/applications/${id}`}
              variant="subtle"
              size="compact-sm"
              leftSection={<Icons.ArrowLeft size={14} />}
            >
              กลับหน้าคำขอ
            </Button>
            <div>
              <h1 className="text-2xl font-semibold text-foreground">
                ตัวอย่างเอกสารคำขอ {application.applicationNumber || '-'}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                วันที่ยื่น {formatDate(application.createdAt)}
              </p>
            </div>
            <Badge variant="secondary">สถานะ: {withFallback(application.status)}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handlePrint} variant="secondary" leftSection={<Icons.Printer size={14} />}>
              พิมพ์เอกสาร
            </Button>
            <Button
              onClick={handleDownloadPdf}
              variant="filled"
              leftSection={<Icons.Download size={14} />}
              disabled={downloading}
            >
              {downloading ? 'กำลังสร้าง PDF...' : 'ดาวน์โหลด PDF'}
            </Button>
          </div>
        </div>
        {downloadError ? (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{downloadError}</p>
        ) : null}
      </section>

      {katorlor1Error ? (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {katorlor1Error}
        </p>
      ) : null}
      {!katorlor1Error && katorlor1Html === null ? (
        <p role="status" className="rounded-xl border-2 border-muted bg-card px-4 py-6 text-center text-sm text-muted-foreground">
          กำลังประกอบแบบ กทล.1 ของคำขอนี้
        </p>
      ) : null}
      {katorlor1Html ? (
        // The HTML is assembled by the server from the filing's own fields and
        // every applicant-supplied value is escaped there
        // (katorlor1-template.test.js, SEC-001). Rendering it here is what makes
        // the review page and the PDF the same document.
        <section
          className="rounded-2xl border border-muted bg-card p-6"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: katorlor1Html }}
        />
      ) : null}
    </div>
  );
}
