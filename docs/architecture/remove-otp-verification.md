# การลบระบบ OTP Verification
## ทำให้การสมัครสมาชิกง่ายขึ้น (เอกสารยืนยันตัวตนเข้มงวดอยู่แล้ว)

---

## 📋 การเปลี่ยนแปลงที่ต้องทำ

### 1. Database Schema Changes

```sql
-- ลบคอลัมน์ที่เกี่ยวข้องกับ OTP
ALTER TABLE "User" DROP COLUMN IF EXISTS "phoneVerified";
ALTER TABLE "User" DROP COLUMN IF EXISTS "emailVerified";
ALTER TABLE "User" DROP COLUMN IF EXISTS "twoFactorEnabled";
ALTER TABLE "User" DROP COLUMN IF EXISTS "twoFactorSecret";

-- ลบตาราง OTP ถ้ามี
DROP TABLE IF EXISTS "OtpCode";
DROP TABLE IF EXISTS "VerificationToken";
```

### 2. API Flow ใหม่ (ไม่มี OTP)

```
ก่อนแก้ไข:
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Register  │───▶│  Send OTP   │───▶│ Verify OTP  │───▶│   Active    │
│             │    │             │    │             │    │   Account   │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘

หลังแก้ไข:
┌─────────────┐    ┌─────────────┐
│   Register  │───▶│   Active    │
│  (Simple)   │    │   Account   │
└─────────────┘    └─────────────┘
```

### 3. ข้อดีของการลบ OTP

- ✅ สมัครเร็วขึ้น (ไม่ต้องรอ SMS)
- ✅ ลดค่าใช้จ่าย SMS
- ✅ ลดปัญหา OTP ไม่มาถึง
- ✅ เอกสารยืนยันตัวตน (บัตรประชาชน) มีความน่าเชื่อถือสูงอยู่แล้ว

### 4. ความปลอดภัยที่ยังคงมี

- ✅ Password strength validation
- ✅ Thai ID Card verification (checksum)
- ✅ Email verification (optional)
- ✅ Document upload ในการสมัคร GACP
- ✅ Manual verification โดยเจ้าหน้าที่

---

## 🔧 รายการไฟล์ที่ต้องแก้ไข

1. `apps/backend/prisma/schema.prisma` - ลบ fields ที่เกี่ยวข้อง
2. `apps/backend/routes/api/auth.js` - ลบ OTP endpoints
3. `apps/backend/services/auth-service.js` - ลบ OTP logic
4. `apps/backend/services/otp-service.js` - ลบไฟล์ (หรือเก็บไว้ก่อน)
5. `apps/web-app/src/pages/register.jsx` - ลบขั้นตอน OTP
6. `apps/web-app/src/pages/login.jsx` - ลบ 2FA

---

## ⚠️ หมายเหตุ

เนื่องจากระบบ GACP ต้องการเอกสารยืนยันตัวตน (บัตรประชาชน) ในการสมัครใบรับรองอยู่แล้ว การลบ OTP จึงไม่กระทบความปลอดภัยมากนัก เนื่องจาก:

1. มีการตรวจสอบบัตรประชาชนจริง
2. มีเจ้าหน้าที่ตรวจสอบเอกสาร
3. มีการตรวจสอบที่อยู่และฟาร์มจริง
