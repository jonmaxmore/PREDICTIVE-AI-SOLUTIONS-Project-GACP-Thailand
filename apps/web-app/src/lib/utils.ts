import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { isThaiIdChecksumValid } from '@gacp/validation/thai-id-checksum';
import { THAI_TIME_ZONE } from '@/lib/format/thai-date';

/**
 * Combines multiple class names
 * 
 * @param inputs - Class names to combine
 * @returns Merged class string
 * 
 * @example
 * cn('btn', 'btn-primary', isActive && 'active')
 * // => 'btn btn-primary active'
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats a date to Thai locale
 */
export function formatThaiDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('th-TH', {
    timeZone: THAI_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Formats a date to Thai short format
 */
export function formatThaiDateShort(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('th-TH', {
    timeZone: THAI_TIME_ZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Calculates days remaining until a date
 */
export function getDaysRemaining(targetDate: Date | string): number {
  const target = typeof targetDate === 'string' ? new Date(targetDate) : targetDate;
  const now = new Date();
  const diff = target.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/**
 * Truncates text with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}

/**
 * Formats a number as Thai Baht currency
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
  }).format(amount);
}

/**
 * Formats a number with thousand separators
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('th-TH').format(num);
}

/**
 * Validates a 13-digit Health ID (เลขประจำตัวประชาชน).
 *
 * The check digit comes from `@gacp/validation/thai-id-checksum`, the single
 * implementation in the repo (F-G4-10). Unlike the shared function this one does
 * not accept dashes, because its callers pass an already-normalised value.
 */
export function validateHealthId(id: string): boolean {
  if (!/^[0-9]{13}$/.test(id)) return false;
  return isThaiIdChecksumValid(id);
}
/** @deprecated Use validateHealthId */
export const validateThaiId = validateHealthId;

/**
 * Masks a Health ID for privacy display.
 */
export function maskHealthId(id: string): string {
  if (id.length !== 13) return id;
  return `${id.slice(0, 1)}-${id.slice(1, 5)}-${id.slice(5, 10)}-${id.slice(10, 12)}-${id.slice(12)}`;
}
/** @deprecated Use maskHealthId */
export const maskThaiId = maskHealthId;

/**
 * Debounces a function
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Creates a delay promise
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

