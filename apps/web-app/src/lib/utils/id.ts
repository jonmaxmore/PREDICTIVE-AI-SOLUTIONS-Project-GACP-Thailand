/**
 * ID Generation Utilities
 */

/**
 * สร้าง unique ID แบบ lightweight โดยไม่ต้องใช้ library uuid
 * เหมาะสำหรับ client-side temporary IDs (form rows, list keys)
 *
 * ไม่ควรใช้สำหรับ Primary Key ในฐานข้อมูล — ใช้ UUID v4 จาก backend แทน
 */
export const generateId = (): string =>
    Math.random().toString(36).substring(2) + Date.now().toString(36);
