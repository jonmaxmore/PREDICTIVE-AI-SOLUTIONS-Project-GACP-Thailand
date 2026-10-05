# 🔥 GACP Platform - Smoke Test Execution Guide

> คู่มือการรัน Smoke Test สำหรับทดสอบระบบทั้งหมด

---

## 📋 Prerequisites

ก่อนรัน Smoke Test ต้องมี:

1. **Local Environment รันอยู่**
   ```powershell
   .\scripts\local-deploy.ps1 start
   ```

2. **Provider Accounts ถูกสร้างแล้ว**
   - reviewer / Test@12345
   - auditor / Test@12345
   - scheduler / Test@12345
   - accountant / Test@12345
   - admin / Admin@12345

3. **Payment Gateway อยู่ใน Mock Mode**
   ```env
   PAYMENT_GATEWAY=MOCK
   ```

---

## 🚀 Quick Start

### รัน Journey A (Happy Path) อย่างเดียว
```powershell
.\tests\smoke\journey-a-happy-path.ps1
```

### รันทุก Journey
```powershell
.\tests\smoke\run-all-smoke-tests.ps1
```

### รันแบบ Parallel (เร็วขึ้น)
```powershell
.\tests\smoke\run-all-smoke-tests.ps1 -Parallel
```

### รันกับ Environment อื่น
```powershell
.\tests\smoke\journey-a-happy-path.ps1 -ApiUrl "https://staging.api.com/api" -WebUrl "https://staging.web.com"
```

---

## 🎭 User Journey ทั้งหมด

| Journey | ชื่อ | รายละเอียด | ระยะเวลา |
|---------|------|-----------|----------|
| **A** | Health Happy Path | สมัคร → ยื่น → จ่าย → ออกใบรับรอง | ~3-5 นาที |
| **B** | Corporate Bundle | นิติบุคคล ยื่น 2 ใบพร้อมกัน | ~5-7 นาที |
| **C** | Renewal Flow | ต่ออายุใบรับรอง | ~3-4 นาที |
| **D** | Reject & CAR | Reject + Corrective Action | ~4-6 นาที |

---

## 📊 Test Coverage

### Stage ที่ทดสอบ

```
┌─────────────────────────────────────────────────────────────┐
│  STAGE 1: Authentication                                     │
│  ├── Health Registration (บุคคลธรรมดา/นิติบุคคล)              │
│  ├── Health Login                                            │
│  └── Provider Login (ทุก Role)                                  │
├─────────────────────────────────────────────────────────────┤
│  STAGE 2: Application                                        │
│  ├── Create Farm                                             │
│  ├── Submit Application (Form 9/10/11)                       │
│  ├── Upload Documents                                        │
│  └── DTAM Data (Water, Seed, Fertilizer)                     │
├─────────────────────────────────────────────────────────────┤
│  STAGE 3: Payment Phase 1                                    │
│  ├── Generate Invoice (5,000 THB)                            │
│  ├── Process Payment                                         │
│  └── Webhook Callback                                        │
├─────────────────────────────────────────────────────────────┤
│  STAGE 4: Provider Workflow                                     │
│  ├── Reviewer Approve/Reject                                 │
│  ├── Scheduler Schedule Audit                                │
│  ├── Auditor Inspection                                      │
│  └── CAR (if needed)                                         │
├─────────────────────────────────────────────────────────────┤
│  STAGE 5: Payment Phase 2                                    │
│  ├── Generate Invoice (25,000 THB)                           │
│  └── Process Payment                                         │
├─────────────────────────────────────────────────────────────┤
│  STAGE 6: Certificate                                        │
│  ├── Auto-generate Certificate                               │
│  ├── Generate QR Code                                        │
│  └── Download PDF                                            │
├─────────────────────────────────────────────────────────────┤
│  STAGE 7: Lot Management                                     │
│  ├── Create Planting Cycle                                   │
│  ├── Create Harvest Batch                                    │
│  ├── Create Lots with QR                                     │
│  └── Print QR Labels                                         │
├─────────────────────────────────────────────────────────────┤
│  STAGE 8: Track & Trace                                      │
│  ├── QR Code Scan                                            │
│  ├── Traceability Data                                       │
│  └── Consumer View                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 📁 Test Output

### Report Files
```
tests/reports/
├── journey-a-20260205-143022.json
├── journey-b-20260205-143215.json
└── summary-20260205.json
```

### Report Format
```json
{
  "TestId": "JOURNEY-A-1234",
  "Timestamp": "20260205-143022",
  "Results": {
    "Journey": "A",
    "Description": "Health Individual Happy Path",
    "Duration": "00:03:45",
    "Stages": [
      { "Name": "Registration", "Status": "PASS", "Duration": "00:00:15" },
      { "Name": "Login", "Status": "PASS", "Duration": "00:00:05" },
      ...
    ]
  },
  "TestData": {
    "Health": { "idCard": "1xxxxxxxxxxxx", "userId": "uuid" },
    "Application": { "id": "uuid", "number": "GACP-2026-001" },
    "Certificate": { "number": "CERT-2026-001", "qrCode": "..." }
  }
}
```

---

## 🐛 Troubleshooting

### ปัญหาที่พบบ่อย

#### 1. SSL Certificate Error
```
Invoke-RestMethod: The SSL connection could not be established
```
**แก้ไข:** Script มี `-SkipCertificateCheck` อยู่แล้ว แต่ถ้ายังมีปัญหา:
```powershell
# Trust the certificate manually
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2("nginx/ssl/local/localhost.crt")
```

#### 2. Provider Login Failed
```
Provider login failed
```
**แก้ไข:** ตรวจสอบว่ามี provider user ในระบบ
```powershell
# สร้าง provider user
node scripts/seed-provider-users.js
```

#### 3. Payment Failed
```
Payment failed
```
**แก้ไข:** ตรวจสอบว่า `PAYMENT_GATEWAY=MOCK` ใน `.env.local`

#### 4. Database Connection
```
Failed to create farm
```
**แก้ไข:** รัน migrations
```bash
cd apps/backend
npx prisma migrate deploy
```

---

## 🔧 Customization

### เพิ่มข้อมูลทดสอบ
แก้ไขในไฟล์ `.ps1` ตรงส่วน `$TestData`:
```powershell
$TestData = @{
    Health = @{
        firstName = "ชื่อใหม่"
        province = "กรุงเทพฯ"
        # ...
    }
}
```

### เพิ่ม Stage ใหม่
```powershell
# ==================== STAGE X: NEW FEATURE ====================
Write-TestHeader "STAGE X: New Feature"

$StageX = @{ Name = "New Feature"; StartTime = Get-Date; Status = "PENDING" }

try {
    $result = Invoke-ApiRequest -Method "POST" -Endpoint "/new-endpoint" -Body $body -Token $token
    
    if ($result.Success) {
        Write-TestStep "New Feature" "PASS"
        $StageX.Status = "PASS"
    }
} catch {
    Write-TestStep "New Feature" "FAIL" $_.Exception.Message
    $StageX.Status = "FAIL"
}

$StageX.EndTime = Get-Date
$TestResults.Stages += $StageX
```

---

## 📈 CI/CD Integration

### GitHub Actions
```yaml
name: Smoke Tests
on: [push, pull_request]

jobs:
  smoke-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Start Services
        run: docker-compose -f docker-compose.local-prod.yml up -d
      
      - name: Run Smoke Tests
        run: |
          pwsh tests/smoke/run-all-smoke-tests.ps1 -ApiUrl "https://localhost/api"
      
      - name: Upload Reports
        uses: actions/upload-artifact@v3
        with:
          name: smoke-test-reports
          path: tests/reports/
```

---

## ✅ Success Criteria

| Criteria | Required | Optional |
|----------|----------|----------|
| All Stages Pass | ✅ | |
| Duration < 10 min/journey | ✅ | |
| No Errors in Logs | ✅ | |
| Report Generated | ✅ | |
| Coverage > 80% | | ✅ |

---

## 📝 Test Data Reference

### Health Types
- `INDIVIDUAL` - บุคคลธรรมดา
- `JURISTIC` - นิติบุคคล
- `COMMUNITY_ENTERPRISE` - วิสาหกิจชุมชน

### Plant Types
- `CANNABIS` - กัญชา
- `TURMERIC` - ขมิ้น
- `GINGER` - ขิง

### Area Types
- `OUTDOOR` - กลางแจ้ง
- `INDOOR` - ในร่ม
- `GREENHOUSE` - เรือนกระจก

---

**Ready to test! 🧪**

เริ่มต้นด้วย: `.\tests\smoke\journey-a-happy-path.ps1`
