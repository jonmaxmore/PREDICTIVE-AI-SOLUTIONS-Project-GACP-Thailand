-- 2026-09-15 · มติ operator: ปัจจัยที่สองมีอย่างเดียวคือ TOTP — 2FA แบบอีเมลถูกปลด
-- (เข้าสู่ระบบด้วย หมอพร้อม / ThaID เท่านั้น ไม่มีอีเมลในระบบ)
--
-- แถวที่ลงทะเบียนด้วยวิธี EMAIL ไม่เคยมี TOTP seed (twoFactorSecret = NULL) ถ้าปล่อยให้
-- twoFactorEnabled ค้างเป็น true ผู้ใช้จะถูกท้าทายด้วย TOTP ที่ไม่มีวันตอบได้ = ล็อกออกถาวร
-- จึงปลดเป็น "ยังไม่ลงทะเบียน" — บทบาทที่ถูกบังคับ MFA (REQUIRE_MFA_FOR_PRIVILEGED) จะถูก
-- ส่งไปลงทะเบียน TOTP ใหม่ที่ประตูล็อกอินตามปกติ; รหัสสำรองของการลงทะเบียนเก่าใช้ไม่ได้อีก
--
-- ไม่แตะ schema: คอลัมน์ twoFactorMethod ยังอยู่ (default 'TOTP') — contract ทีหลังเมื่อไม่มี
-- โค้ดอ่านมันแล้ว (expand-before-contract)
UPDATE "users"
SET "twoFactorEnabled" = false,
    "twoFactorMethod" = 'TOTP',
    "twoFactorSecret" = NULL,
    "twoFactorBackupCodes" = NULL
WHERE "twoFactorMethod" = 'EMAIL';
