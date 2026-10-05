# 📋 วิเคราะห์ความต้องการจากกรมการแพทย์แผนไทยฯ (DTAM)
## เปรียบเทียบระบบปัจจุบันกับความต้องการจาก DTAM

---

## 🎯 สรุปความต้องการจาก DTAM (จากคอมเมนต์/บรีฟ)

### 1. ข้อมูลแปลงปลูก (Plot/Farm Information)

| ความต้องการ | สถานะปัจจุบัน | ระดับความจำเป็น |
|------------|--------------|----------------|
| ระบุหน่วยเป็น **ตารางเมตร** | ✅ มี `areaSqm` ใน Plot model | ✅ มีแล้ว |
| ระบุ **Indoor/Outdoor/โรงเรือน/อาคารผลิต** | ✅ มี `areaType` (OUTDOOR, INDOOR, GREENHOUSE) | ✅ มีแล้ว |
| **อาคารควบคุม** ระบุรูปแบบ | ⚠️ ไม่มี field แยก | 🔴 ต้องเพิ่ม |

### 2. แหล่งน้ำ (Water Source)

| ความต้องการ | สถานะปัจจุบัน | ระดับความจำเป็น |
|------------|--------------|----------------|
| **ประเภทแหล่งน้ำ** (บ่อ/ประปา/ฝน/อื่นๆ) | ⚠️ มี field แต่ไม่ละเอียด | 🟡 ต้องขยาย |
| **ระบบกรองน้ำ** (กรองเกษตร/RO/UV) | ❌ ไม่มี | 🔴 ต้องเพิ่ม |
| **รูปแบบการให้น้ำ** (หยด/พ่น/รด) | ❌ ไม่มี | 🟡 ต้องเพิ่ม |

### 3. วัสดุปลูก (Growing Medium)

| ความต้องการ | สถานะปัจจุบัน | ระดับความจำเป็น |
|------------|--------------|----------------|
| **วัสดุปลูก** (ดิน/รากลอย/มะพร้าว/อื่นๆ) | ❌ ไม่มี | 🔴 ต้องเพิ่ม |
| **ไม่ต้องล็อค** (flexible input) | ⚠️ ต้องแก้เป็น text input | 🟡 แก้ไข |

### 4. แหล่งที่มาพันธุ์พืช (Seed/Plant Source)

| ความต้องการ | สถานะปัจจุบัน | ระดับความจำเป็น |
|------------|--------------|----------------|
| **เอกสารรับรองสายพันธุ์** | ❌ ไม่มี | 🔴 ต้องเพิ่ม |
| **ซื้อมาจากไหน** (แหล่งที่มา) | ❌ ไม่มี | 🔴 ต้องเพิ่ม |
| **ภพ.4 รับรองไหม** | ❌ ไม่มี | 🔴 ต้องเพิ่ม |

### 5. ปัจจัยการผลิต (Production Inputs)

| ความต้องการ | สถานะปัจจุบัน | ระดับความจำเป็น |
|------------|--------------|----------------|
| **ทะเบียนปุ๋ย** (เลข อย./ทะเบียน) | ❌ ไม่มี | 🔴 ต้องเพิ่ม |
| การใส่ปุ๋ย/สารเคมี | ✅ มีใน CultivationLog | ✅ มีแล้ว |

### 6. การเก็บเกี่ยวและแปรรูป (Harvest & Processing)

| ความต้องการ | สถานะปัจจุบัน | ระดับความจำเป็น |
|------------|--------------|----------------|
| **ห้องควบคุมอุณหภูมิ** (มี/ไม่มี) | ✅ มีใน DryingTemperature | ✅ มีแล้ว |
| **อุณหภูมิเท่าไหร่** | ✅ มีใน DryingTemperature | ✅ มีแล้ว |
| **ไม่มีอบ/ไม่มีตาก** (option) | ⚠️ ต้องเพิ่ม checkbox | 🟡 ต้องเพิ่ม |
| **บรรจุภัณฑ์** (ถุงอากาศ/ถุงฟู้ดเกรด) | ⚠️ มีบางส่วนใน Lot | 🟡 ต้องขยาย |
| **วันที่ปลูก** | ✅ มีใน PlantingCycle | ✅ มีแล้ว |
| **วันที่เก็บเกี่ยว** | ✅ มีใน HarvestBatch | ✅ มีแล้ว |
| **ตากกี่วัน** | ⚠️ ต้องคำนวณจาก drying dates | 🟡 ต้องเพิ่ม |

### 7. Track & Trace (ติดตามย้อนกลับ)

| ความต้องการ | สถานะปัจจุบัน | ระดับความจำเป็น |
|------------|--------------|----------------|
| **Track ข้อมูลทั้งหมด** | ✅ มี PlantUnit + QR + Chain of Custody | ✅ มีแล้ว |
| **ย้อนกลับได้ถึงผู้บริโภค** | ✅ มี ConsumerFeedback + QR | ✅ มีแล้ว |
| **Effect tracking** (กรณีผู้บริโภคมีปัญหา) | ⚠️ ต้องเพิ่ม field สำหรับ report | 🟡 ต้องเพิ่ม |

### 8. การขอใบรับรอง (Application Types)

| ความต้องการ | สถานะปัจจุบัน | ระดับความจำเป็น |
|------------|--------------|----------------|
| **ขอ 3 แบบพร้อมกัน** (อย่างละ 30k) | ⚠️ มี 4 types แต่ไม่รองรับ 3 พร้อมกัน | 🔴 ต้องแก้ไข |
| new_application | ✅ มี | ✅ มีแล้ว |
| renewal | ✅ มี | ✅ มีแล้ว |
| replacement | ✅ มี | ✅ มีแล้ว |

### 9. เอกสาร (Documents)

| ความต้องการ | สถานะปัจจุบัน | ระดับความจำเป็น |
|------------|--------------|----------------|
| **ไม่เอาทะเบียนบ้าน** | ✅ ลบออกแล้ว | ✅ แก้แล้ว |
| **ต้องมีโฉนดที่ดิน** (กรมที่ดิน) | ⚠️ มีเอกสารรวม แต่ไม่แยกประเภทชัด | 🔴 ต้องเพิ่ม |
| **ทยอยแนบเอกสาร** (บางส่วนก่อน) | ✅ มี Draft รองรับ | ✅ มีแล้ว |
| **กรอกรายละเอียดที่ดินให้ติ๊ก** (checkbox style) | ❌ เป็น text input | 🟡 ต้องแก้ UI |
| **Video ไม่เอา** | ✅ ลบออกแล้ว | ✅ แก้แล้ว |

### 10. ระบบแก้ไขเอกสาร (Revision System)

| ความต้องการ | สถานะปัจจุบัน | ระดับความจำเป็น |
|------------|--------------|----------------|
| **แก้เอกสารภายใน 5 วัน** | ✅ มี RevisionDeadline | ✅ มีแล้ว |
| **อัพโหลดรูปหลังลงพื้นที่** (Post-audit upload) | ✅ มี PostAuditTask | ✅ มีแล้ว |

---

## 🔴 สิ่งที่ต้องพัฒนาเพิ่ม (Priority High)

### 1. Schema Changes (Database)

```prisma
// 1. Water Source Enhancement
model WaterSource {
  id              String   @id @default(uuid())
  plotId          String
  sourceType      String   // BOREHOLE, TAP_WATER, RAIN, RIVER, POND, OTHER
  filtrationType  String?  // AGRICULTURAL_FILTER, RO, UV, SEDIMENT, NONE
  irrigationType  String?  // DRIP, SPRINKLER, MANUAL, FLOOD
  isTested        Boolean  @default(false)
  testResults     Json?    // { coliform, ph, turbidity }
}

// 2. Growing Medium
model GrowingMedium {
  id          String   @id @default(uuid())
  cycleId     String
  mediumType  String   // SOIL, COCO_PEAT, ROCK_WOOL, HYDROPONIC, AIR_ROOT, OTHER
  brand       String?  // ยี่ห้อ (ถ้ามี)
  supplier    String?  // ซื้อจากไหน
  isOrganic   Boolean  @default(false)
}

// 3. Seed Source Documentation
model SeedSource {
  id                String   @id @default(uuid())
  cycleId           String
  sourceType        String   // SEEDLING, CUTTING, TISSUE_CULTURE
  supplierName      String?
  supplierAddress   String?
  hasCertificate    Boolean  @default(false)
  certificateUrl    String?  // เอกสารรับรองสายพันธุ์
  isRegistered      Boolean  @default(false)  // ภพ.4 รับรอง
  registrationNo    String?  // เลขทะเบียนภพ.4
}

// 4. Fertilizer Registry
model FertilizerRecord {
  id              String   @id @default(uuid())
  cycleId         String
  brandName       String
  registrationNo  String   // เลข อย./ทะเบียนปุ๋ย
  type            String   // ORGANIC, CHEMICAL, BIO
  usageDate       DateTime
  amount          Float
  unit            String   // kg, L, g
}

// 5. Building/Structure Control
model ControlledEnvironment {
  id                String   @id @default(uuid())
  plotId            String
  structureType     String   // GREENHOUSE, NET_HOUSE, GROW_ROOM, PROCESSING_ROOM
  hasTempControl    Boolean  @default(false)
  hasHumidityControl Boolean @default(false)
  tempRangeMin      Int?
  tempRangeMax      Int?
}
```

### 2. API Changes

```javascript
// New Routes to Add:
POST   /api/plots/:id/water-source
GET    /api/plots/:id/water-source
POST   /api/cycles/:id/growing-medium
POST   /api/cycles/:id/seed-source
POST   /api/cycles/:id/fertilizers
GET    /api/fertilizers/registry         // ค้นหาปุ๋ยจากทะเบียน
POST   /api/plots/:id/controlled-env
```

### 3. Frontend Changes

```
Wizard Step 3: Farm Information (แก้ไข)
├── Water Source Section (ใหม่)
│   ├── ประเภทแหล่งน้ำ [Select]
│   ├── ระบบกรองน้ำ [Multi-select]
│   └── รูปแบบการให้น้ำ [Select]
│
├── Land Documents (แก้ไข)
│   ├── ✅ โฉนดที่ดิน (บังคับ)
│   ├── ⬜ น.ส.3
│   └── ⬜ ส.ป.ก.
│
└── เอกสารรับรองแปลง [Upload]

Wizard Step 4: Plot Details (แก้ไข)
├── Growing Medium (ใหม่)
│   ├── วัสดุปลูก [Text input - ไม่ล็อค]
│   ├── ยี่ห้อ [Text]
│   └── แหล่งที่ซื้อ [Text]
│
├── Seed Source (ใหม่)
│   ├── แหล่งที่มา [Select + Text]
│   ├── เอกสารรับรอง [Upload]
│   └── ภพ.4 รับรอง [Checkbox + เลขที่]
│
└── Structure Type [Radio]
    ├── Outdoor
    ├── Indoor
    ├── โรงเรือน
    └── อาคารควบคุม [แสดง fields เพิ่ม]
```

---

## 🟡 สิ่งที่ต้องแก้ไขปานกลาง (Priority Medium)

### 1. Application Types (ขอ 3 แบบพร้อมกัน)

**วิธีแก้ไข:**
```prisma
// เพิ่ม model ใหม่
model ApplicationBundle {
  id              String   @id @default(uuid())
  userId          String
  bundleType      String   // TRIPLE_GACP
  totalFee        Int      // 90000 (30000 x 3)
  applications    Application[]
  status          String   @default("PENDING")
}

// หรือแก้ไข Application model
model Application {
  // ... existing fields
  isBundle        Boolean  @default(false)
  bundleId        String?
  bundleOrder     Int?     // 1, 2, 3 for triple
}
```

### 2. Packaging Details

```prisma
model PackagingDetail {
  id            String   @id @default(uuid())
  batchId       String
  packageType   String   // VACUUM_BAG, FOOD_GRADE_BAG, CONTAINER
  bagType       String?  // AIR_BAG, FOOD_GRADE
  grade         String?  // FOOD_GRADE, MEDICAL_GRADE
  storageTemp   Int?     // อุณหภูมิเก็บรักษา
  storageDays   Int?     // จำนวนวันเก็บ
}
```

### 3. Drying Duration Calculation

```javascript
// เพิ่ม field ใน DryingProcess
model DryingProcess {
  // ... existing fields
  dryingDays    Int      @default(0)  // คำนวณ auto
  startDate     DateTime
  endDate       DateTime?
}
```

---

## 📝 วางแผนการพัฒนา (Development Plan)

### Phase 1: Database Schema (1 สัปดาห์)
- [ ] เพิ่ม WaterSource model
- [ ] เพิ่ม GrowingMedium model
- [ ] เพิ่ม SeedSource model
- [ ] เพิ่ม FertilizerRecord model
- [ ] เพิ่ม ControlledEnvironment model
- [ ] เพิ่ม PackagingDetail model
- [ ] Migration

### Phase 2: Backend API (1 สัปดาห์)
- [ ] CRUD API สำหรับ WaterSource
- [ ] CRUD API สำหรับ GrowingMedium
- [ ] CRUD API สำหรับ SeedSource
- [ ] CRUD API สำหรับ FertilizerRecord
- [ ] ค้นหาปุ๋ยจากทะเบียน (mock/external API)

### Phase 3: Frontend Wizard (2 สัปดาห์)
- [ ] แก้ไข Step 3: Farm Info
- [ ] แก้ไข Step 4: Plot Details
- [ ] เพิ่ม fields ใหม่ทั้งหมด
- [ ] ปรับ UI เป็น Checkbox style

### Phase 4: Testing (1 สัปดาห์)
- [ ] Unit tests
- [ ] Integration tests
- [ ] UAT with DTAM

---

## ✅ สรุป

### มีแล้ว (Working) ✅
- Track & Trace ระบบ QR
- Planting Cycle + Harvest
- 2-Phase Payment
- Document Upload
- Revision System (5 วัน)
- Post-Audit Upload
- Area Type (Indoor/Outdoor)

### ต้องเพิ่ม (Missing) 🔴
- ข้อมูลแหล่งน้ำละเอียด
- วัสดุปลูก
- แหล่งที่มาพันธุ์พืช + เอกสาร
- ทะเบียนปุ๋ย
- ขอ 3 ใบรับรองพร้อมกัน
- โฉนดที่ดิน (บังคับ)
- Packaging details

### ต้องแก้ไข (Modify) 🟡
- เอกสารเป็น Checkbox style
- Drying process (เพิ่มจำนวนวัน)
- Application bundle (3 ใบพร้อมกัน)

---

**จัดทำเมื่อ:** 2026-02-05  
**วิเคราะห์โดย:** Kimi Code CLI  
**อ้างอิงจาก:** คอมเมนต์/บรีฟ DTAM
