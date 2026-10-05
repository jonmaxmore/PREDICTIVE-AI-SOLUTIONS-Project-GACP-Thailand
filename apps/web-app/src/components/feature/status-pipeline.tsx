/**
 * StatusPipeline — clip-path chevron strip for visualising a state
 * machine on a detail page.
 *
 * Visual spec:
 *   • Pipeline height: 33px
 *   • Chevron arrow depth: 12px (~1em at 12-13px text scale)
 *   • Active chevron: primary fill
 *   • Past chevrons: success/leaf-700 fill (completed)
 *   • Future chevrons: muted/grey fill
 *   • First chevron: no left cut-in (entrance shape)
 *   • Last chevron: no right point (exit shape)
 *
 * The component is presentation-only (no hooks) so it server-renders
 * cleanly. Imported either via the @/components/feature barrel for
 * client components, or directly from this file for Server Components.
 */
import { cn } from '@/lib/utils';

export interface PipelineStep {
  key: string;
  /** Full label — used as the title attribute on hover */
  label: string;
  /** Optional shorter label rendered inside the chevron */
  shortLabel?: string;
}

interface Props {
  steps: PipelineStep[];
  /** key of the current step. Past steps render as completed. */
  currentKey: string;
  /**
   * When true, the current step renders as completed (e.g. terminal
   * states like CERTIFIED). Defaults to false (current is highlighted).
   */
  isTerminal?: boolean;
  /**
   * Optional helper text rendered below the pipeline (e.g. the
   * `ขั้นตอนที่ N จาก M` counter or stage description).
   */
  caption?: React.ReactNode;
  /** Optional Tailwind classes appended to the outer wrapper */
  className?: string;
}

// Chevron clip-paths. 12px arrow depth ≈ 1em at the platform's
// 12-13px small-text scale, which keeps text-inside-chevron legible.
const CHEVRON_DEPTH = 12;
const POLY_FIRST = `polygon(0 0, calc(100% - ${CHEVRON_DEPTH}px) 0, 100% 50%, calc(100% - ${CHEVRON_DEPTH}px) 100%, 0 100%)`;
const POLY_MIDDLE = `polygon(0 0, calc(100% - ${CHEVRON_DEPTH}px) 0, 100% 50%, calc(100% - ${CHEVRON_DEPTH}px) 100%, 0 100%, ${CHEVRON_DEPTH}px 50%)`;
const POLY_LAST = `polygon(0 0, 100% 0, 100% 100%, 0 100%, ${CHEVRON_DEPTH}px 50%)`;

export function StatusPipeline({ steps, currentKey, isTerminal = false, caption, className }: Props) {
  const currentIdx = Math.max(0, steps.findIndex(s => s.key === currentKey));

  if (steps.length === 0) return null;

  return (
    <div
      className={cn('rounded-2xl border border-border bg-card p-4 shadow-sm', className)}
      role="status"
      aria-label="ความคืบหน้าของคำขอ"
    >
      <ol className="flex h-[33px] items-stretch gap-0.5">
        {steps.map((step, idx) => {
          const isFirst = idx === 0;
          const isLast = idx === steps.length - 1;
          const polygon = isFirst ? POLY_FIRST : isLast ? POLY_LAST : POLY_MIDDLE;

          // Past steps + (terminal) current step → completed (leaf-700)
          // Current step (non-terminal) → active (primary)
          // Future steps → muted (slate)
          const isComplete = idx < currentIdx || (isTerminal && idx === currentIdx);
          const isCurrent = idx === currentIdx && !isTerminal;

          return (
            <li
              key={step.key}
              aria-current={isCurrent ? 'step' : undefined}
              title={step.label}
              className={cn(
                'flex flex-1 items-center justify-center overflow-hidden px-3 text-[11px] font-bold uppercase tracking-wide transition-colors',
                isComplete && 'bg-leaf-700 text-white',
                isCurrent && 'bg-primary text-primary-foreground',
                !isComplete && !isCurrent && 'bg-slate-100 text-slate-500',
              )}
              style={{ clipPath: polygon }}
            >
              <span className="truncate">{step.shortLabel || step.label}</span>
            </li>
          );
        })}
      </ol>

      {caption ? (
        <div className="mt-3 text-xs text-muted-foreground">{caption}</div>
      ) : null}
    </div>
  );
}
