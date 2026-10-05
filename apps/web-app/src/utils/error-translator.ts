/**
 * Error Translator Utility
 * Translates English API errors to Thai for user-friendly display
 *
 * DEAD AT RUNTIME (verified 2026-07-03, Wave-C adversarial-verify F2):
 * `translateError` has ZERO production callers — every API error message
 * the UI renders flows through `lib/api/api-client.ts` instead
 * (`toUserFriendlyError` + the 403 ENTITY_PERMISSION_DENIED pass-through
 * in `lib/api/entity-permission-denial.ts`). Do NOT add translations here
 * expecting them to surface; wire them in the api-client (or delete this
 * module when convenient). The Wave-C workspace-denial branch that briefly
 * lived here was removed for exactly that reason — it was dead code with a
 * false-green test.
 *
 * @author GACP Engineering Team
 * @version 1.0.0
 */

// Error message mapping (English → Thai)
const errorMap: Record<string, string> = {
    // Login errors
    "Invalid credentials": "เลขประจำตัวหรือรหัสผ่านไม่ถูกต้อง",
    "Invalid email or password": "เลขประจำตัวหรือรหัสผ่านไม่ถูกต้อง",
    "User not found": "ไม่พบบัญชีผู้ใช้นี้ กรุณาลงทะเบียนก่อน",
    "Account is locked": "บัญชีถูกล็อค กรุณารอ 30 นาทีแล้วลองใหม่",
    "Account locked. Try again in": "บัญชีถูกล็อคชั่วคราว กรุณารอสักครู่แล้วลองใหม่",
    "Account is disabled": "บัญชีนี้ถูกระงับการใช้งาน",
    "Account not verified": "บัญชียังไม่ได้ยืนยันตัวตน",
    "Password incorrect": "รหัสผ่านไม่ถูกต้อง",

    // Registration errors
    "User already exists": "มีบัญชีผู้ใช้นี้แล้ว กรุณาเข้าสู่ระบบ",
    "Email already registered": "อีเมลนี้ถูกใช้งานแล้ว",
    "Email already exists": "อีเมลนี้ถูกใช้งานแล้ว",
    "Phone already registered": "เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว",
    "Phone number already registered": "เบอร์โทรศัพท์นี้ถูกใช้งานแล้ว",
    "Invalid Laser Code format": "รูปแบบเลข Laser Code ไม่ถูกต้อง",
    "Invalid ID format": "รูปแบบเลขประจำตัวไม่ถูกต้อง",

    // Network errors
    "Failed to fetch": "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบอินเทอร์เน็ต",
    "Network Error": "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้",
    "Internal Server Error": "เซิร์ฟเวอร์มีปัญหา กรุณาลองใหม่ภายหลัง",
    "Service Unavailable": "ระบบไม่พร้อมให้บริการชั่วคราว",

    // Validation errors
    "Password too weak": "รหัสผ่านไม่ปลอดภัยเพียงพอ",
    "Passwords do not match": "รหัสผ่านไม่ตรงกัน",
    "Invalid phone number": "เบอร์โทรศัพท์ไม่ถูกต้อง",
    "Invalid email": "อีเมลไม่ถูกต้อง",
};

/**
 * Translate English API error to Thai
 * @param englishError - Error message from API
 * @returns Thai translated error message
 */
export function translateError(englishError: string): string {
    // Check exact match first
    if (errorMap[englishError]) {
        return errorMap[englishError];
    }

    // Check partial matches (case-insensitive)
    for (const [key, value] of Object.entries(errorMap)) {
        if (englishError.toLowerCase().includes(key.toLowerCase())) {
            return value;
        }
    }

    // If error contains English, return generic Thai error
    if (/[a-z]/i.test(englishError)) {
        return "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
    }

    // Return original if already in Thai or unknown format
    return englishError;
}

// Default export
const errorTranslatorUtils = { translateError };

export default errorTranslatorUtils;
