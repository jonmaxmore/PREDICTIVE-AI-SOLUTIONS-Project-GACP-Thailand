'use strict';

/**
 * Document pre-check words that both sides of the wire print, defined once.
 *
 * Walk D5 (evidence/document-precheck-2026-09-27/real-stack/INDEX.md): a FAILED
 * pre-check had three wordings — the API flag, the applicant card and the officer
 * row each spelled their own. The backend writes this string into the FAILED row's
 * one flag (services/document-precheck/status.js FAILURE_FLAG); the web card and the
 * officer row print the same constant. Plain CommonJS for the same reason as
 * upload-rules.js: Node requires it, Next transpiles it.
 *
 * Wording: spec §5 applicant copy, verbatim. It reads true to both audiences — the
 * applicant learns an officer will look, the officer reads that the check is theirs.
 */

/** A FAILED pre-check, everywhere it is shown. */
const PRECHECK_FAILED_TH = 'ตรวจอัตโนมัติไม่สำเร็จ เจ้าหน้าที่จะตรวจเอง';

module.exports = { PRECHECK_FAILED_TH };
