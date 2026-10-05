import type { Language } from '@/lib/i18n/language-context';
import { bangkokDateParts } from '@/lib/format/thai-date';

/**
 * The page-footer copyright line. Thai pages lead with the Buddhist Era year
 * and gloss the Gregorian one; an English page has no use for the BE year.
 * The holder is Suan Sunandha Rajabhat University (operator ruling 2026-10-05).
 * The year is the Bangkok calendar year, like every other printed date.
 */
export function copyrightLine(template: string, language: Language, yearAD = bangkokDateParts(new Date())!.year): string {
  const year = language === 'th' ? `${yearAD + 543} (${yearAD})` : `${yearAD}`;
  return template.replace('{year}', year);
}
