-- Seed Feature Flags into SystemConfig
-- Run this on server if not using seed-config.js
-- Uses INSERT ... ON CONFLICT to avoid overwriting existing admin changes

INSERT INTO "system_configs" ("id", "key", "value", "type", "description", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'feature.task_router', 'true', 'BOOLEAN', 'แสดง Task Router (หน้าเริ่มต้นเลือกบริการ)', NOW(), NOW()),
  (gen_random_uuid(), 'feature.readiness_check', 'true', 'BOOLEAN', 'แสดง Readiness Check (ตรวจความพร้อมก่อนยื่นคำขอ)', NOW(), NOW()),
  (gen_random_uuid(), 'feature.document_repo', 'true', 'BOOLEAN', 'แสดง Document Repository (เอกสารของฉัน)', NOW(), NOW()),
  (gen_random_uuid(), 'feature.sop_library', 'true', 'BOOLEAN', 'แสดง SOP Library (ดาวน์โหลดแบบฟอร์ม SOP 8 หมวด)', NOW(), NOW()),
  (gen_random_uuid(), 'feature.report_center', 'true', 'BOOLEAN', 'แสดง Report Center (ส่งรายงานรายเดือน ภ.ท.27/28)', NOW(), NOW()),
  (gen_random_uuid(), 'feature.plant_unit_tracking', 'false', 'BOOLEAN', 'แสดง PlantUnit Tracking (ติดตามรายต้น) — Pro feature', NOW(), NOW()),
  (gen_random_uuid(), 'feature.official_templates', 'true', 'BOOLEAN', 'แสดง Official Document Center (เอกสารทางการ)', NOW(), NOW()),
  (gen_random_uuid(), 'feature.export_documents', 'false', 'BOOLEAN', 'แสดง Export Documents (เอกสารส่งออก) — เร็วๆ นี้', NOW(), NOW()),
  (gen_random_uuid(), 'feature.permit_forms', 'false', 'BOOLEAN', 'แสดงแบบฟอร์มใบอนุญาต ภ.ท.09/10/11/12 (รอทีมอื่นทำฟอร์มเต็ม)', NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;
