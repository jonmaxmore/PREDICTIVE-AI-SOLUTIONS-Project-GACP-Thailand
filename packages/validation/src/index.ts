/**
 * @gacp/validation
 * Shared validation utilities for GACP platform
 */

// The Thai 13-digit check digit — the single implementation in the repo.
// Exported from the package root so TypeScript callers do not need to know it
// happens to be a `.js` file (it is CommonJS so the backend can require it too).
export {
    THAI_ID_LENGTH,
    THAI_ID_PAYLOAD_LENGTH,
    THAI_ID_REJECTION,
    normalizeThaiId,
    thaiIdCheckDigit,
    isThaiIdChecksumValid,
    checkThaiId,
} from './thai-id-checksum';

export * from './thai-id';

// Default export for convenience
export { validateThaiId as default } from './thai-id';
