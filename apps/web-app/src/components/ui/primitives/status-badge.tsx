import { Badge, type BadgeProps } from '@/components/ui/primitives/badge';
import { cn } from '@/lib/utils';

const statusToneMap: Record<string, BadgeProps['tone']> = {
  WAITING_PAYMENT: 'warning',
  WAITING_DOCUMENT_REVIEW: 'info',
  WAITING_AUDIT: 'warning',
  CERTIFIED: 'success',
  APPROVED: 'success',
  REJECTED: 'danger',
  DRAFT: 'neutral',
  // 8-stage model
  PENDING_FEE_PHASE1: 'warning',
  UNDER_DOCUMENT_REVIEW: 'info',
  REVISION_REQUIRED: 'danger',
  PENDING_FEE_PHASE2: 'warning',
  UNDER_FIELD_AUDIT: 'info',
};

// ui_kit redesign (2026-06-08): each status chip leads with a small tone-
// coloured dot, so state reads by colour *and* word (design north star).
const dotToneMap: Record<NonNullable<BadgeProps['tone']>, string> = {
  neutral: 'bg-slate-400',
  success: 'bg-leaf-600',
  warning: 'bg-amber-500',
  info: 'bg-sky-500',
  danger: 'bg-red-500',
  primary: 'bg-primary',
};

interface StatusBadgeProps {
  status: string;
  label: string;
}

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const tone = statusToneMap[String(status || '').toUpperCase()] || 'neutral';
  return (
    <Badge tone={tone}>
      <span className={cn('mr-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full', dotToneMap[tone ?? 'neutral'])} aria-hidden="true" />
      {label}
    </Badge>
  );
}

