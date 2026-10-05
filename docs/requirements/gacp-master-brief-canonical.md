# GACP Canonical Workflow, SOW, and JD (Master Brief)

Version: 1.1  
Date: 2026-03-04  
Status: Active Canonical Source

## 1) Job Descriptions and Journeys by Role

### 1.1 HEALTH_USER / User (เกษตรกร / ผู้ประกอบการ)
- Role: ผู้ยื่นขอรับรองมาตรฐาน
- Responsibilities:
  - ให้ข้อมูลแปลงปลูกและกระบวนการผลิตตามความจริง
  - จัดเตรียมเอกสารวิชาการและ SOP ตามมาตรฐาน GACP
  - ชำระค่าธรรมเนียมตามกรอบเวลาที่ระบบกำหนด
- Journey:
  - Onboarding: สมัครสมาชิกและเข้าสู่ระบบครั้งแรก
  - Application: กรอกข้อมูลและอัปโหลดเอกสาร (ระบบล็อกฟอร์มทันทีที่ส่ง)
  - Payment 1: ชำระค่าตรวจเอกสาร 5,000 บาทผ่านระบบอัตโนมัติ
  - Revision: เข้าแก้ไขฟอร์มได้เฉพาะเมื่อ Auditor ส่งกลับแก้ไข
  - Payment 2: ชำระค่าประเมินหน้างาน 25,000 บาทเมื่อเอกสารผ่าน
  - Field Audit: เตรียมความพร้อมแปลงปลูกตามวันนัดหมาย
  - CAR Resolve: อัปโหลดหลักฐานแก้ไขเมื่อพบข้อบกพร่องหน้างาน
  - Completion: ดาวน์โหลดใบรับรองเมื่อสถานะเป็น `CERTIFIED`

### 1.2 Coordinator (เจ้าหน้าที่ประสานงานและจัดคิวงาน)
- Department: บริหารจัดการและประสานงาน
- Reports to: หัวหน้าแผนกตรวจสอบ
- Responsibilities:
  - Task Assignment: ตรวจรายการที่จ่าย 5,000 แล้วและมอบหมาย Auditor
  - Scheduling: ประสานวันลงพื้นที่และบันทึกนัดหมายในระบบ
  - Monitoring: ติดตามภาพรวมเพื่อไม่ให้เกิดงานค้าง
- Journey:
  - Assigning: แจกจ่ายงานที่ `DOC_FEE_PAID` แล้ว
  - Scheduling: เมื่องาน `AUDIT_FEE_PAID` แล้วให้กำหนดวันลงพื้นที่
  - Monitoring: ติดตามความคืบหน้าทุกสถานะ
- Strict Rule:
  - ไม่มีสิทธิ์ตรวจเนื้อหาเอกสารหรือให้คะแนนการประเมิน
  - ไม่มีสิทธิ์ยืนยันการชำระเงินแทน webhook

### 1.3 Auditor (เจ้าหน้าที่ตรวจสอบเอกสารและประเมินหน้างาน)
- Department: ตรวจสอบและรับรองมาตรฐาน
- Reports to: หัวหน้าเจ้าหน้าที่ตรวจสอบ
- Responsibilities:
  - Document Review: ตรวจเอกสารและสั่งแก้ไขพร้อม comment
  - Field Audit: บันทึก checklist และรูปถ่ายจากการตรวจหน้างาน
  - CAR Issuing: ออก CAR และตรวจหลักฐานการแก้ไข
- Journey:
  - Reviewing: ตรวจงานที่ได้รับมอบหมาย ไม่ผ่านต้อง Reject พร้อม comment
  - Auditing: ลงพื้นที่ประเมินและบันทึกผลแบบ real-time
  - CAR Issuing: ออก CAR และรอตรวจหลักฐานที่ผู้ยื่นส่งกลับมา
- Strict Rule:
  - ไม่มีสิทธิ์มอบหมายงานให้ตนเอง
  - ไม่มีสิทธิ์จัดการเรื่องการเงิน

### 1.4 Head Auditor / Final Approver (หัวหน้าเจ้าหน้าที่ตรวจสอบ)
- Department: บริหารจัดการมาตรฐานและนโยบาย
- Reports to: คณะกรรมการบริหาร
- Responsibilities:
  - Final Review: ตรวจความสมเหตุสมผลของคะแนนและหลักฐาน
  - Final Approval: อนุมัติขั้นสุดท้ายเพื่อให้ออกใบรับรอง
- Journey:
  - Validation: ตรวจรายงานประเมินและ CAR ให้ครบถ้วน
  - Approval: กดอนุมัติผลสุดท้ายเพื่อเปลี่ยนเป็น `APPROVED`
  - Issuance: ตรวจความถูกต้องของใบรับรองที่ระบบสร้าง
- Strict Rule:
  - ห้ามแก้คะแนนโดยไม่มีหลักฐานรองรับ

### 1.5 Accountant (เจ้าหน้าที่บัญชี)
- Department: บัญชีและการเงิน
- Reports to: ผู้อำนวยการฝ่ายการเงิน
- Responsibilities:
  - Financial Reconciliation: ตรวจยอดรับชำระจาก gateway เทียบกับระบบ
  - Invoicing/Tax Invoice: ออกใบกำกับภาษี/ใบเสร็จอย่างเป็นทางการ
  - Billing Support: ดูแลกรณีชำระเงินล้มเหลวหรือขอคืนเงินตามนโยบาย
- Journey:
  - Settlement Review: ตรวจยอดรับชำระรายวันจาก webhook report
  - Reconciliation: ตรวจ Transaction ID ระหว่าง GACP กับธนาคาร
  - Billing Support: จัดการงานภาษีและกระบวนการ refund

## 2) Canonical State Machine

| Current Status | Actor | Action | Next Status |
|---|---|---|---|
| `REGISTERED` | User | กรอกฟอร์ม + อัปโหลด | `SUBMITTED` |
| `SUBMITTED` | User/System | เริ่มการชำระ 5,000 | `PENDING_DOC_FEE` |
| `PENDING_DOC_FEE` | Webhook | ยืนยันชำระ 5,000 | `DOC_FEE_PAID` |
| `DOC_FEE_PAID` | Coordinator | Assign Auditor | `ASSIGNED_FOR_REVIEW` |
| `ASSIGNED_FOR_REVIEW` | Auditor | Review ผ่าน/ส่งแก้ | `DOC_APPROVED` / `REVISION_REQUESTED` |
| `REVISION_REQUESTED` | User | แก้ไขและส่งกลับ | `ASSIGNED_FOR_REVIEW` |
| `DOC_APPROVED` | User/System | เริ่มการชำระ 25,000 | `PENDING_AUDIT_FEE` |
| `PENDING_AUDIT_FEE` | Webhook | ยืนยันชำระ 25,000 | `AUDIT_FEE_PAID` |
| `AUDIT_FEE_PAID` | Coordinator | ลงนัดหมาย | `AUDIT_CONFIRMED` |
| `AUDIT_CONFIRMED` | Auditor | บันทึกผลตรวจ | `AUDIT_PASSED` / `CAR_PENDING` |
| `CAR_PENDING` | User | ส่งหลักฐานแก้ไข | `CAR_REVIEWING` |
| `CAR_REVIEWING` | Auditor | ตรวจหลักฐาน | `AUDIT_PASSED` |
| `AUDIT_PASSED` | Head Auditor | อนุมัติสุดท้าย | `APPROVED` |
| `APPROVED` | System | สร้างใบรับรอง | `CERTIFIED` |

Note:
- Accountant ไม่มีสิทธิ์เปลี่ยน workflow status โดยตรง
- Accountant ดำเนินการเฉพาะ reconciliation, tax invoice, receipt, refund workflows

## 3) Safety Rules (Non-Negotiable)
- No Manual Bypass: ห้าม Coordinator/Auditor/Accountant เปลี่ยนเป็น `DOC_FEE_PAID` หรือ `AUDIT_FEE_PAID` เองเด็ดขาด (ต้อง webhook เท่านั้น)
- Lock on Review: ขณะอยู่ในมือผู้ตรวจ (`ASSIGNED_FOR_REVIEW`, `AUDIT_CONFIRMED`, `CAR_REVIEWING`) ฝั่ง User ต้องเป็น Read-only
- Mandatory Comments: ทุก transition ที่ส่งกลับ User (`REVISION_REQUESTED`, `CAR_PENDING`) ต้องมี comment และบันทึกใน `Application_Comments`

## 4) Statement of Work (SOW)

### 4.1 Project Overview
พัฒนาและปรับปรุงระบบบริหารจัดการการขอใบรับรอง GACP ให้รองรับการทำงานอัตโนมัติ ความปลอดภัยข้อมูล และการแบ่งสิทธิ์ที่ชัดเจนตาม Separation of Duties

### 4.2 Scope of Work
- System Architecture
  - Layered Architecture: Service / Repository / API Routes
  - State Machine ตามลำดับขั้นตอนในเอกสารนี้
  - RBAC สำหรับ 5 บทบาท: User, Coordinator, Auditor, Head Auditor, Accountant
- Key Modules
  - Application Module (ยื่นคำขอ, อัปโหลดเอกสาร, unlock เฉพาะ `REVISION_REQUESTED` และ `CAR_PENDING`)
  - Payment Gateway Integration (Webhook 5,000 และ 25,000)
  - Audit & Review Module (ตรวจเอกสาร, checklist หน้างาน, CAR)
  - Scheduling Module (Coordinator)
  - Certification Module (PDF + QR)
  - Finance Operations Module (Reconciliation, Receipt/Tax Invoice, Refund Support)
- Data Management
  - Prisma/PostgreSQL Schema
  - Audit Trail สำหรับ comments, transitions, และ transaction logs

### 4.3 Deliverables
- Source Code (clean, ไม่เป็น monolith)
- Database Schema รองรับ workflow และการตรวจสอบย้อนหลัง
- API Documentation ครบทุก endpoint
- User Manual แยกตามบทบาท
- Deployment Script สำหรับ production

### 4.4 Technical Requirements
- Clean Code: ไฟล์ logic ไม่เกิน 300 บรรทัด (ต้องแยกส่วนเมื่อเกิน)
- Security: ตรวจ signature ของ webhook ทุกครั้ง
- Integrity: ทุก transition ต้องตรวจ role + pre-condition
- Legacy Cleanup: โค้ดเก่าที่ขัดกับเอกสารนี้ต้อง refactor หรือถอดออก

### 4.5 Timeline Estimation
- Week 1: Database Refactoring + State Machine Design
- Week 2: API (RBAC + Payment Webhook)
- Week 3: Frontend + Form Unlocking
- Week 4: PDF Generation + Testing + Deployment

### 4.6 Acceptance Criteria
- Flow เดินครบตาม state machine โดยไม่มี logic error
- User แก้ไขข้อมูลได้เฉพาะสถานะที่อนุญาต
- Payment webhook เปลี่ยนสถานะได้อัตโนมัติแบบไม่มี manual verification
- แยกหน้าที่งานตามบทบาทโดยไม่มี role bypass
- ไม่มี anti-pattern ด้านโค้ด (monolith/hardcoded/duplicate logic)

## 5) Canonical Governance Rule
- เอกสารนี้เป็น Single Source of Truth ของ Workflow/SOW/JD
- หากมีเอกสารอื่นที่ขัดแย้ง ให้ถือว่าไม่ถูกต้องและต้องถอดออก
