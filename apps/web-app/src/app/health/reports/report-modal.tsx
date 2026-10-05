'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Send, X } from 'lucide-react';
import { Button } from '@/components/ui/primitives/button';
import { apiClient as api } from '@/lib/api/api-client';
import { REPORT_FIELDS, THAI_MONTHS, type ReportModalData, type ScheduleData } from './report-types';

interface ReportModalProps {
  modalData: ReportModalData;
  formValues: Record<string, string>;
  setFormValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  submitting: boolean;
  setSubmitting: React.Dispatch<React.SetStateAction<boolean>>;
  submitError: string | null;
  setSubmitError: React.Dispatch<React.SetStateAction<string | null>>;
  onClose: () => void;
  onSuccess: (data: ScheduleData) => void;
}

export function ReportModal({
  modalData,
  formValues,
  setFormValues,
  submitting,
  setSubmitting,
  submitError,
  setSubmitError,
  onClose,
  onSuccess,
}: ReportModalProps) {
  // a11y — close on Escape (WCAG 2.1.2). Submitting-in-progress is preserved
  // because the backend call is fire-and-forget on close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-modal-title"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg rounded-2xl bg-background p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 id="report-modal-title" className="text-lg font-bold">{modalData.reportTypeName}</h3>
            <p className="text-sm text-muted-foreground">
              เดือน {THAI_MONTHS[modalData.month - 1]} {modalData.year} {modalData.farmName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            title="ปิด"
            aria-label="ปิดหน้าต่างกรอกรายงาน"
          >
            <X className="h-5 w-5" aria-hidden="true" focusable="false" />
          </button>
        </div>

        <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
          {(REPORT_FIELDS[modalData.reportType] || []).map((field) => (
            <div key={field.id}>
              <label className="mb-1 block text-sm font-medium" htmlFor={`report-field-${field.id}`}>
                {field.label}
                {field.required && <span className="ml-0.5 text-red-500" aria-hidden="true">*</span>}
                {field.required && <span className="sr-only"> (จำเป็น)</span>}
                {field.suffix && <span className="ml-1 text-xs text-muted-foreground">({field.suffix})</span>}
              </label>
              {field.type === 'textarea' ? (
                <textarea
                  id={`report-field-${field.id}`}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  rows={3}
                  required={field.required}
                  placeholder={field.placeholder}
                  value={formValues[field.id] || ''}
                  onChange={(e) =>
                    setFormValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                  }
                />
              ) : field.type === 'select' ? (
                <select
                  id={`report-field-${field.id}`}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  value={formValues[field.id] || ''}
                  required={field.required}
                  onChange={(e) =>
                    setFormValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                  }
                >
                  <option value="">เลือก</option>
                  {field.options?.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  id={`report-field-${field.id}`}
                  type={field.type}
                  required={field.required}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  placeholder={field.placeholder}
                  value={formValues[field.id] || ''}
                  onChange={(e) =>
                    setFormValues((prev) => ({ ...prev, [field.id]: e.target.value }))
                  }
                />
              )}
              {field.helpText && (
                <p className="mt-0.5 text-[10px] text-muted-foreground">{field.helpText}</p>
              )}
            </div>
          ))}
        </div>

        {submitError && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300" role="alert">
            {submitError}
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <Button
            variant="outline"
            className="flex-1 rounded-full"
            onClick={async () => {
              setSubmitting(true);
              setSubmitError(null);
              try {
                await api.post('/api/report-submissions', {
                  certificateId: modalData.certificateId,
                  reportType: modalData.reportType,
                  reportMonth: modalData.month,
                  reportYear: modalData.year,
                  formData: formValues,
                  submitNow: false,
                });
                onClose();
                const res = await api.get<ScheduleData>('/api/report-submissions/schedule');
                // apiClient unwraps one envelope level; `res.data` IS the schedule.
                if (res.data) onSuccess(res.data);
              } catch {
                setSubmitError('เกิดข้อผิดพลาด กรุณาลองใหม่');
              } finally {
                setSubmitting(false);
              }
            }}
            disabled={submitting}
          >
            บันทึกร่าง
          </Button>
          <Button
            className="flex-1 gap-2 rounded-full"
            onClick={async () => {
              const fields = REPORT_FIELDS[modalData.reportType] || [];
              const missing = fields
                .filter((f) => f.required && !(formValues[f.id] || '').trim())
                .map((f) => f.label);
              if (missing.length > 0) {
                setSubmitError(`กรุณากรอก: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ` และอีก ${missing.length - 3} ช่อง` : ''}`);
                return;
              }
              setSubmitting(true);
              setSubmitError(null);
              try {
                await api.post('/api/report-submissions', {
                  certificateId: modalData.certificateId,
                  reportType: modalData.reportType,
                  reportMonth: modalData.month,
                  reportYear: modalData.year,
                  formData: formValues,
                  submitNow: true,
                });
                onClose();
                const res = await api.get<ScheduleData>('/api/report-submissions/schedule');
                // apiClient unwraps one envelope level; `res.data` IS the schedule.
                if (res.data) onSuccess(res.data);
              } catch {
                setSubmitError('เกิดข้อผิดพลาด กรุณาลองใหม่');
              } finally {
                setSubmitting(false);
              }
            }}
            disabled={submitting}
          >
            {submitting ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" focusable="false" />
            )}
            ส่งรายงาน
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
