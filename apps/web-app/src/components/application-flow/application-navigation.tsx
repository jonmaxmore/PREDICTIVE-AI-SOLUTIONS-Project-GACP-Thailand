'use client';

import React from 'react';
import { Icons } from '@/components/ui/icons';
import { cn } from '@/lib/utils';
import { DEMO_MODE } from '@/lib/constants';

interface ApplicationNavigationProps {
  onBack?: () => void;
  onNext?: () => void;
  isNextDisabled?: boolean;
  isBackDisabled?: boolean;
  nextLabel?: string;
  backLabel?: string;
  isSubmitting?: boolean;
  showBack?: boolean;
  /** ขั้นสุดท้ายของแบบฟอร์มไม่มี "ถัดไป" — ปุ่มที่นั่นคือการยื่นคำขอ ซึ่งมีเงื่อนไขของตัวเอง */
  showNext?: boolean;
  customNextButton?: React.ReactNode;
  className?: string;
}

export const ApplicationNavigation: React.FC<ApplicationNavigationProps> = ({
  onBack,
  onNext,
  isNextDisabled = false,
  isBackDisabled = false,
  nextLabel = 'ดำเนินการต่อ',
  backLabel = 'ย้อนกลับ',
  isSubmitting = false,
  showBack = true,
  showNext = true,
  customNextButton,
  className,
}) => {
  return (
    <div className={cn('mt-8 flex items-center justify-between gap-3 border-t border-border pt-6', className)}>
      <div>
        {showBack && onBack ? (
          <button
            type="button"
            onClick={onBack}
            disabled={isBackDisabled || isSubmitting}
            className="btn-friendly inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-5 text-sm font-semibold text-foreground transition-all duration-200 hover:bg-slate-50 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Icons.ChevronLeft size={16} />
            {backLabel}
          </button>
        ) : null}
      </div>

      <div>
        {!showNext ? null : customNextButton ? (
          customNextButton
        ) : (
          <button
            type="button"
            onClick={onNext}
            disabled={DEMO_MODE ? false : (isNextDisabled || isSubmitting)}
            className="btn-friendly gov-gradient inline-flex h-11 min-w-[180px] items-center justify-center gap-2 rounded-xl px-6 text-sm font-bold text-white shadow-lg shadow-primary/20 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:hover:translate-y-0"
          >
            {isSubmitting ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-white" aria-hidden="true" />
            ) : null}
            <span>{nextLabel}</span>
            {!isSubmitting ? <Icons.ChevronRight size={16} /> : null}
          </button>
        )}
      </div>
    </div>
  );
};

export default ApplicationNavigation;
