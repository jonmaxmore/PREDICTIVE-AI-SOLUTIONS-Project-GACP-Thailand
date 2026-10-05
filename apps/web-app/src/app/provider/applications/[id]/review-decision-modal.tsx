'use client';

import { ActionIcon } from '@/components/ui/icon-buttons';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/primitives/button';
import { Modal } from '@/components/ui/overlays';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input as TextInput } from '@/components/ui/primitives/input';
import { IconAlertTriangle, IconCheck, IconPlus, IconSend, IconTrash } from '@tabler/icons-react';
import { REVISION_CATEGORIES } from './provider-application-detail-config';

interface ReviewDecisionModalProps {
  opened: boolean;
  onClose: () => void;
  reviewAction: 'approve' | 'revision';
  reviewComment: string;
  onReviewCommentChange: (value: string) => void;
  revisionCategory: string;
  onRevisionCategoryChange: (value: string) => void;
  revisionItems: string[];
  onAddRevisionItem: () => void;
  onUpdateRevisionItem: (index: number, value: string) => void;
  onRemoveRevisionItem: (index: number) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
}

export function ReviewDecisionModal({
  opened,
  onClose,
  reviewAction,
  reviewComment,
  onReviewCommentChange,
  revisionCategory,
  onRevisionCategoryChange,
  revisionItems,
  onAddRevisionItem,
  onUpdateRevisionItem,
  onRemoveRevisionItem,
  onSubmit,
  isSubmitting,
}: ReviewDecisionModalProps) {
  const revisionBlocked = reviewAction === 'revision'
    && !reviewComment.trim()
    && revisionItems.every((item) => !item.trim());

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      size="lg"
      title={reviewAction === "approve" ? "ยืนยันการอนุมัติเอกสาร" : "ขอให้แก้ไขเอกสาร"}
    >
      <div className="flex flex-col">
        {reviewAction === "approve" ? (
          <Alert color="teal" icon={<IconCheck size={16} />} title="อนุมัติเอกสาร">
            เอกสารบังคับครบถ้วนและถูกต้อง
          </Alert>
        ) : (
          <Alert color="orange" icon={<IconAlertTriangle size={16} />} title="คำขอการแก้ไข">
            กรุณาระบุประเภทปัญหาและรายการที่ต้องแก้ไขให้ชัดเจน
          </Alert>
        )}

        {reviewAction === "revision" && (
          <>
            <Select
              label="ประเภทการแก้ไข"
              data={REVISION_CATEGORIES}
              value={revisionCategory}
              onChange={(value) => onRevisionCategoryChange(value || "MISSING_DOCUMENT")}
            />

            <div role="group" aria-labelledby="revision-items-heading">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p id="revision-items-heading" className="text-sm font-semibold">รายการที่ต้องแก้ไข</p>
                <Button size="sm" leftSection={<IconPlus size={14} />} onClick={onAddRevisionItem}>
                  เพิ่มรายการ
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                {revisionItems.map((item, index) => (
                  <div className="flex flex-wrap items-center gap-2" key={`item-${index}`}>
                    <TextInput
                      className="flex-1"
                      value={item}
                      onChange={(event) => onUpdateRevisionItem(index, event.currentTarget.value)}
                      placeholder={`รายการที่ ${index + 1}`}
                      aria-label={`รายการที่ต้องแก้ไข ${index + 1}`}
                    />
                    <ActionIcon
                      color="red"
                      aria-label={`ลบรายการที่ ${index + 1}`}
                      onClick={() => onRemoveRevisionItem(index)}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </div>
                ))}
                {revisionItems.length === 0 && (
                  <p className="text-sm text-slate-500">เพิ่มรายการที่ต้องแก้ไขอย่างน้อย 1 รายการ</p>
                )}
              </div>
            </div>
          </>
        )}

        {/* X2-FIX-A M-13: autoFocus the comment textarea so keyboard
            reviewers land on the primary writeable input instead of
            the Cancel button (Radix Dialog otherwise focuses the
            close button on mount). The Textarea forwards props to
            the underlying HTMLTextAreaElement so this maps to the
            standard `autoFocus` attribute.
            // reason: jsx-a11y/no-autofocus warns against autoFocus
            // for top-level page elements, but this is a modal
            // dialog that opens in response to an explicit user
            // action (clicking "อนุมัติเอกสาร" or "ขอให้แก้ไข"). For
            // modals the WAI-ARIA APG recommends moving focus to
            // the first interactive element — the X2-C audit
            // explicitly flagged the absence of this behaviour as
            // a Level A failure (4.1.2). Disabling the lint rule
            // for this single attribute is the documented
            // exception.
        */}
        <Textarea
          label="หมายเหตุ"
          value={reviewComment}
          onChange={(event) => onReviewCommentChange(event.currentTarget.value)}
          placeholder={reviewAction === "approve" ? "บันทึกเพิ่มเติม (ถ้ามี)" : "อธิบายสิ่งที่ต้องแก้ไข"}
          required={reviewAction === "revision"}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- reason: modal dialog focus per WAI-ARIA APG (see X2-FIX-A M-13).
          autoFocus
          data-testid="review-comment-textarea"
        />

        <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <Button variant="default" onClick={onClose} disabled={isSubmitting}>ยกเลิก</Button>
          <Button
            color={reviewAction === "approve" ? "teal" : "orange"}
            leftSection={<IconSend size={14} />}
            onClick={onSubmit}
            loading={isSubmitting}
            disabled={revisionBlocked}
          >
            {reviewAction === "approve" ? "ยืนยันอนุมัติ" : "ส่งคำขอแก้ไข"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
