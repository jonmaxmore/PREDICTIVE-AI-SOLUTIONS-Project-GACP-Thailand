'use client';

/**
 * ConfirmDialog — Wave E.3-C.
 *
 * Drop-in replacement for `window.confirm()` that respects the design
 * system, supports i18n, and lets callers control button labels +
 * destructive styling.
 *
 * Why not just keep `window.confirm`:
 * - Native confirm() text is locale-locked to the browser's UI language,
 *   not the app's. A Thai user with browser set to English will see
 *   "Cancel / OK" alongside Thai dialog copy — jarring and untranslatable.
 * - Native confirm() can't be styled to match the rest of the app.
 * - Native confirm() blocks the JS event loop, which interferes with
 *   React state updates and event flushing.
 *
 * Why a dumb component, not an imperative hook:
 * - The 8 call sites in this codebase already manage their own intent
 *   state (which row, which action). A component that takes `open` +
 *   `onConfirm` slots directly into that state without imposing a
 *   provider/context.
 * - If a future call site needs an imperative async API, a thin
 *   `useConfirm` hook can wrap this component without re-implementing
 *   the visual chrome.
 *
 * Built on the existing `Dialog` primitive — which is already Radix-
 * based — so focus management, escape-to-close, and ARIA roles match
 * the rest of the design system.
 */
import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/primitives/dialog';
import { Button } from '@/components/ui/primitives/button';
import { useLanguage } from '@/lib/i18n/language-context';

export interface ConfirmDialogProps {
  /** Visibility — caller-controlled. */
  open: boolean;
  /** Fires when the dialog wants to close (cancel button, X, escape, overlay click). */
  onOpenChange: (open: boolean) => void;
  /**
   * Fires when the user confirms. The component does NOT auto-close on
   * confirm — caller decides (typical: close + run side effect).
   * Returning a Promise is supported; the confirm button shows a
   * loading state while it resolves.
   */
  onConfirm: () => void | Promise<void>;
  /** Dialog title (already-translated string). */
  title: React.ReactNode;
  /** Dialog body / explanation (already-translated string). */
  description: React.ReactNode;
  /** Confirm-button label override. Defaults to t('common.confirm'). */
  confirmLabel?: React.ReactNode;
  /** Cancel-button label override. Defaults to t('common.cancel'). */
  cancelLabel?: React.ReactNode;
  /**
   * When 'destructive', the confirm button is red — for delete /
   * leave-without-saving / forfeit-progress flows. Default is
   * 'default' which uses the primary green button.
   */
  variant?: 'default' | 'destructive';
}

export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = 'default',
}: ConfirmDialogProps) {
  const { t } = useLanguage();
  const [isPending, setIsPending] = React.useState(false);

  const handleConfirm = async () => {
    setIsPending(true);
    try {
      await onConfirm();
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={isPending}
          >
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
