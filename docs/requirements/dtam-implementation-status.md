# สถานะการพัฒนาตามความต้องการ DTAM
## เปรียบเทียบระหว่างความต้องการ vs ระบบปัจจุบัน

---

## ✅ มีแล้ว (Implemented)

### 1. โฉนดที่ดิน (เอกสารสิทธิ์ที่ดิน)
**ตำแหน่ง:** `StepFarmInfo.tsx` line 95
```typescript
const FARM_DOCUMENTS = [
    { id: 'LAND_TITLE', name: 'เอกสารสิทธิ์ที่ดิน', required: true, hint: 'โฉนด, น.ส.3, หรือ ส.ป.ก.' },
    // ...
];
```
**สถานะ:** ✅ มีแล้ว แต่ต้องตั้งเป็น required

### 2. ระบบน้ำหยด/สปริงเกลอร์ (Irrigation)
**ตำแหน่ง:** `StepProductionInfo.tsx` line 39-44
```typescript
const IRRIGATION_OPTIONS = [
    { value: 'DRIP', label: 'ระบบน้ำหยด (Drip)' },
    { value: 'SPRINKLER', label: 'สปริงเกลอร์ (Sprinkler)' },
    { value: 'MANUAL', label: 'รดน้ำด้วยมือ (Manual)' },
    { value: 'FLOOD', label: 'ท่วมขัง (Flood)' },
];
```
**สถานะ:** ✅ มีแล้ว

### 3. วัสดุปลูก (Growing Medium)
**ตำแหน่ง:** `StepProductionInfo.tsx` line 69-77
```typescript
const PLANTING_MATERIAL_OPTIONS = [
    { value: 'SOIL', label: 'ดิน (Soil)' },
    { value: 'COCO_PEAT', label: 'กาบมะพร้าว (Coco Peat)' },
    { value: 'PERLITE', label: 'เพอร์ไลท์ (Perlite)' },
    { value: 'ROCKWOOL', label: 'ร็อควูล (Rockwool)' },
    { value: 'HYDROPONIC', label: 'ไฮโดรโปนิกส์ (Hydroponic)' },
    { value: 'AEROPONIC', label: 'แอโรโปนิกส์ (Aeroponic)' },
    { value: 'MIX', label: 'ดินผสม/อื่นๆ' },
];
```
**สถานะ:** ✅ มีแล้ว รวมถึง aeroponics (รากลอย)

### 4. ทะเบียนปุ๋ย (Fertilizer Registration)
**ตำแหน่ง:** `StepProductionInfo.tsx` line 85
```typescript
interface ProductionInput {
    // ...
    registrationNumber?: string; // DTAM: ทะเบียนปุ๋ย
}
```
**สถานะ:** ✅ มี field แล้ว แต่ต้องเพิ่ม validation

### 5. Indoor/Outdoor/โรงเรือน
**ตำแหน่ง:** `StepFarmInfo.tsx` line 78-82
```typescript
const SITE_TYPE_BY_CULTIVATION: Record<string, { value: string; label: string }> = {
    'outdoor': { value: 'OUTDOOR', label: 'กลางแจ้ง' },
    'greenhouse': { value: 'GREENHOUSE', label: 'โรงเรือน' },
    'indoor': { value: 'INDOOR', label: 'อาคารควบคุม/ในร่ม' },
};
```
**สถานะ:** ✅ มีแล้ว

### 6. Track & Trace (QR + Chain of Custody)
**ตำแหน่ง:** 
- Backend: `schema.prisma` - PlantUnit, Lot, ChainOfCustody
- Frontend: `app/trace/*`
**สถานะ:** ✅ มีระบบแล้ว

---

## 🔴 ไม่มี/ไม่สมบูรณ์ (Missing/Incomplete)

### 1. แหล่งน้ำ (Water Source) - ไม่สมบูรณ์
**ที่มี:** แค่ irrigation type (น้ำหยด/สปริงเกลอร์)
**ที่ขาด:**
- ประเภทแหล่งน้ำ (บ่อ/ประปา/น้ำฝน/แม่น้ำ)
- ระบบกรองน้ำ (กรองเกษตร/RO/UV)
- ผลตรวจคุณภาพน้ำ (coliform, pH)

**ต้องเพิ่มใน:** `StepFarmInfo.tsx`

### 2. แหล่งที่มาพันธุ์พืช (Seed Source) - ไม่มี
**ที่ขาด:**
- เอกสารรับรองสายพันธุ์ (ใบเซอร์)
- แหล่งที่ซื้อ (ชื่อร้าน/ที่อยู่)
- ภพ.4 รับรองหรือไม่ (checkbox + เลขทะเบียน)

**ต้องเพิ่มใน:** `StepProductionInfo.tsx`

### 3. อาคารควบคุม (Controlled Environment) - ไม่มี
**ที่ขาด:**
- รูปแบบอาคารควบคุม (Greenhouse/Net house/Grow room)
- ระบบควบคุมอุณหภูมิ (มี/ไม่มี)
- ระบบควบคุมความชื้น (มี/ไม่มี)
- ช่วงอุณหภูมิที่ควบคุม

**ที่มี:** มีแค่ "อาคารควบคุม/ในร่ม" แต่ไม่มี detail

### 4. ขอ 3 ใบรับรองพร้อมกัน - ไม่มี
**ที่มี:** เลือกได้แค่ 1 type ต่อครั้ง
**ที่ขาด:** Bundle application (3 types พร้อมกัน = 90,000 บาท)

### 5. บรรจุภัณฑ์ (Packaging) - ไม่สมบูรณ์
**ที่ขาด:**
- ถุงอากาศ vs ถุงฟู้ดเกรด (ชัดเจน)
- เกรดบรรจุภัณฑ์ (Food grade/Medical grade)

---

## 📊 สรุปเปอร์เซ็นต์ความสมบูรณ์

| หมวดหมู่ | ความสมบูรณ์ | หมายเหตุ |
|----------|------------|----------|
| ข้อมูลแปลง (Plot) | 70% | มีพื้นฐาน แต่ขาด controlled env |
| แหล่งน้ำ (Water) | 30% | มี irrigation แต่ขาด source + filtration |
| วัสดุปลูก (Medium) | 90% | มีครบ รวม aeroponics |
| พันธุ์พืช (Seed) | 20% | มี propagation type แต่ขาด certificate |
| ปุ๋ย (Fertilizer) | 60% | มี field แต่ไม่มี validation |
| Track & Trace | 90% | มีครบ QR + Chain |
| เอกสาร (Documents) | 80% | มีโฉนด แต่ต้องปรับเป็น checkbox style |
| การขอใบรับรอง | 50% | มี 4 types แต่ไม่รองรับ 3 พร้อมกัน |

**รวม:** ~65% สมบูรณ์

---

## 🎯 แนะนำการพัฒนาต่อ

### ระยะสั้น (1-2 สัปดาห์)
1. **เพิ่ม Seed Source Section**
   - อัปโหลดใบเซอร์พันธุ์พืช
   - Checkbox ภพ.4 + ระบุเลข
   - ช่องกรอกแหล่งที่ซื้อ

2. **ขยาย Water Source**
   - Select: บ่อน้ำ/ประปา/ฝน/แม่น้ำ
   - Multi-select: ระบบกรอง

3. **ปรับ UI เอกสาร**
   - จาก Text input → Checkbox
   - โฉนด / น.ส.3 / ส.ป.ก. / อื่นๆ

### ระยะกลาง (1 เดือน)
4. **Application Bundle**
   - เลือกได้มากกว่า 1 type
   - คำนวณค่าธรรมเนียมรวม

5. **Controlled Environment Detail**
   - ระบุอุณหภูมิ min/max
   - ระบบควบคุม humidity

### ระยะยาว (2-3 เดือน)
6. **ระบบค้นหาปุ๋ยจากทะเบียน อย.**
   - Integrate API หรือ Database ปุ๋ย

---

## 💡 คำแนะนำเพิ่มเติม

### สิ่งที่ DTAM อาจต้องการในอนาคต
จากแนวโน้ม GACP สากล:

1. **Blockchain for Traceability**
   - บันทึกข้อมูลลง Blockchain
   - ป้องกันการแก้ไขย้อนหลัง

2. **IoT Integration**
   - เชื่อมต่อเซ็นเซอร์อุณหภูมิ/ความชื้น
   - บันทึกอัตโนมัติ

3. **AI Prediction**
   - คาดการณ์วันเก็บเกี่ยว
   - แจ้งเตือนโรคพืช

4. **Mobile App for Inspectors**
   - Offline mode
   - บันทึกการตรวจในฟาร์ม

---

**รายงานจัดทำเมื่อ:** 2026-02-05  
**วิเคราะห์จาก:** Codebase + ความต้องการ DTAM
