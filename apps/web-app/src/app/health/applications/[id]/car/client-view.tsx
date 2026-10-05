'use client';


import { Container } from '@/components/ui/layout-utils';
import { FileInput } from '@/components/ui/form-controls';
import { List, LoadingOverlay } from '@/components/ui/data-components';
import { Button } from '@/components/ui/primitives/button';
import { Alert } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/primitives/badge';
import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { IconUpload, IconAlertCircle, IconCheck, IconFileText } from '@tabler/icons-react';
import { notifications } from '@/lib/notifications';
import { apiClient } from '@/lib/api/api-client';
import { useLanguage } from '@/lib/i18n/language-context';

interface CARItem {
  id: string;
  issue: string;
  requirement: string;
  deadline?: string;
}

interface Application {
  id: string;
  applicationNumber: string;
  status: string;
  carItems?: CARItem[] | undefined;
  formData?: {
    _lastReviewComment?: string;
    carItems?: CARItem[];
  };
}


export default function CARUploadPage() {
  const params = useParams();
  const router = useRouter();
  const applicationId = params.id as string;
  const { dict, language } = useLanguage();
  const car = dict.health.car;

  const [application, setApplication] = useState<Application | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState('');
  // V1-B (D5): Inline error / upload-error state. Replaces the prior
  // `notifications.show({ color: 'red' })` toast that auto-dismissed after
  // ~4s — applicants who looked away missed the "ไม่สามารถโหลดข้อมูลได้"
  // and the rest of /health/* surfaces fetch errors as a persistent inline
  // Alert (see `health/payments/client-view.tsx:300-302`). We surface BOTH
  // load-time and upload-time failures via the same Alert so the user always
  // sees what went wrong without timing out.
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    fetchApplication();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  const fetchApplication = async () => {
    try {
      setLoading(true);
      setFetchError(null);
      const result = await apiClient.get<Application>(`/applications/${applicationId}`);

      if (!result.success) throw new Error('Failed to fetch');

      // apiClient unwraps one envelope level (api-client.ts:410); backend
      // returns single-level `{ success, data: app }`
      // (application-workflow-handlers.js:195) — so `result.data` IS the app.
      setApplication(result.data || null);

      // Extract CAR items from formData
      if (result.data?.formData?.carItems) {
        setApplication(prev => prev ? {
          ...prev,
          carItems: result.data?.formData?.carItems,
        } : null);
      }
    } catch (_error) {
      // V1-B (D5): persistent inline error instead of 4-second toast.
      setFetchError(car.errorFetch);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitCAR = async () => {
    if (files.length === 0) {
      notifications.show({
        title: car.missingFileTitle,
        message: car.missingFileBody,
        color: 'yellow',
      });
      return;
    }

    try {
      setUploading(true);
      setUploadError(null);

      const formData = new FormData();
      // ชื่อฟิลด์ต้องซ้ำกันทุกไฟล์ ไม่ใช่ carDocument0/carDocument1 — ประตูอ่านด้วย
      // upload.array('carDocument', 10) ซึ่งเป็นวิธีรับหลายไฟล์ของ multer และมันปฏิเสธ
      // ชื่อที่ไม่ตรงด้วย MulterError: Unexpected field (วัดจริง 2026-09-07)
      files.forEach((file) => {
        formData.append('carDocument', file);
      });
      formData.append('notes', notes);
      formData.append('applicationId', applicationId);

      const result = await apiClient.post(`/applications/${applicationId}/car`, formData);

      if (!result.success) throw new Error('Failed to upload');

      notifications.show({
        title: car.successTitle,
        message: car.successBody,
        color: 'green',
        icon: <IconCheck size={16} />,
      });

      router.push(`/health/applications/${applicationId}`);
    } catch (_error) {
      // V1-B (D5): persistent inline error instead of 4-second toast so
      // the applicant doesn't miss it while focused on the file input.
      setUploadError(car.errorUpload);
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <Container size="full" data-testid="car-loading">
        <LoadingOverlay visible />
      </Container>
    );
  }

  // V1-B (D5): persistent inline error when the fetch failed. Distinct from
  // the "no application found" empty-state below so the applicant can tell
  // a network failure (retry-able) apart from a 404 (wrong link / no perm).
  if (fetchError) {
    return (
      <Container size="full">
        <Alert
          data-testid="car-fetch-error"
          icon={<IconAlertCircle size={16} />}
          title={car.errorTitle}
          color="red"
        >
          <p className="mb-2 text-sm">{fetchError}</p>
          <Button
            variant="default"
            size="sm"
            onClick={() => void fetchApplication()}
          >
            {car.retry}
          </Button>
        </Alert>
      </Container>
    );
  }

  if (!application) {
    return (
      <Container size="full">
        <Alert
          data-testid="car-not-found"
          icon={<IconAlertCircle size={16} />}
          title={car.notFoundTitle}
          color="red"
        >
          {car.notFoundBody}
        </Alert>
      </Container>
    );
  }

  const isCarRequired = application.status === 'CAR_PENDING' ||
    application.status === 'REVISION_REQUESTED' ||
    Boolean(application.formData?._lastReviewComment);

  if (!isCarRequired) {
    return (
      <Container size="full">
        <Alert icon={<IconAlertCircle size={16} />} title={car.notRequiredTitle} color="blue">
          {car.notRequiredBody}
        </Alert>
      </Container>
    );
  }

  return (
    <Container size="full">
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            <IconFileText size={32} style={{ verticalAlign: 'middle', marginRight: 8 }} />
            {car.title}
          </h2>
          <p className="text-sm text-slate-500">
            {car.subtitle.replace('{appNumber}', application.applicationNumber)}
          </p>
        </div>

        <Alert icon={<IconAlertCircle size={16} />} color="yellow" title={car.yellowTitle}>
          <p className="mb-2 text-sm">
            {car.requiredBody}
          </p>
          {application.formData?._lastReviewComment && (
            <p className="mt-2 text-sm font-medium">
              {car.officerNote}{application.formData._lastReviewComment}
            </p>
          )}
        </Alert>

        {application.carItems && application.carItems.length > 0 && (
          <div className="rounded-lg bg-card p-4 shadow-sm">
            <p className="mb-3 font-semibold">{car.attachLabel}</p>
            <List spacing="sm">
              {application.carItems.map((item, index) => (
                <List.Item key={item.id || index}>
                  <p className="font-medium">{item.issue}</p>
                  <p className="text-sm text-slate-500">{item.requirement}</p>
                  {item.deadline && (
                    <Badge size="sm" color="red">
                      {car.within.replace('{date}', new Date(item.deadline).toLocaleDateString(language === 'en' ? 'en-US' : 'th-TH'))}
                    </Badge>
                  )}
                </List.Item>
              ))}
            </List>
          </div>
        )}

        <div className="rounded-lg bg-card p-4 shadow-sm">
          <div className="flex flex-col gap-4">
            <div>
              <p className="mb-2 font-semibold">{car.attachFiles}</p>
              <FileInput
                multiple
                placeholder={car.selectFiles}
                value={files}
                onChange={(fileSelection) => {
                  if (Array.isArray(fileSelection)) {
                    setFiles(fileSelection);
                    return;
                  }
                  setFiles(fileSelection ? [fileSelection] : []);
                }}
                accept="image/*,application/pdf"
                leftSection={<IconUpload size={16} />}
              />
              <p className="mt-2 text-xs text-slate-500">
                {car.supportedFiles}
              </p>
            </div>

            {files.length > 0 && (
              <Alert color="blue" title={car.selectedFiles}>
                <List size="sm">
                  {files.map((file, index) => (
                    <List.Item key={index}>
                      {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
                    </List.Item>
                  ))}
                </List>
              </Alert>
            )}

            <Textarea
              label={car.notesLabel}
              placeholder={car.notesPlaceholder}
              value={notes}
              onChange={(e) => setNotes(e.currentTarget.value)}
              rows={4}
            />

            {/* V1-B (D5): persistent inline error on submission failure,
                replacing the prior 4-second toast that disappeared while
                the applicant was still reviewing their files. */}
            {uploadError ? (
              <Alert
                data-testid="car-upload-error"
                icon={<IconAlertCircle size={16} />}
                title={car.errorTitle}
                color="red"
              >
                {uploadError}
              </Alert>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center">
              <Button
                variant="default"
                onClick={() => router.push(`/health/applications/${applicationId}`)}
              >
                {car.cancel}
              </Button>
              <Button
                onClick={handleSubmitCAR}
                loading={uploading}
                disabled={files.length === 0}
                leftSection={<IconCheck size={16} />}
              >
                {car.submit}
              </Button>
            </div>
          </div>
        </div>

        <Alert icon={<IconAlertCircle size={16} />} color="blue">
          <p className="text-sm">
            {car.footerNote}
          </p>
        </Alert>
      </div>
    </Container>
  );
}
