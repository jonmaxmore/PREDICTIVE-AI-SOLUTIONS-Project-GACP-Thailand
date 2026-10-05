/// The fee-line catalogue — the mobile app's ONE copy
/// (backend: apps/backend/shared/instalment-service-names.js).
///
/// Screens prefer the server's words (GET /applications/:id/quotations
/// `copy.services`, GET /invoices/my `service`); this file is for labels that
/// have no server answer at hand (the stage timeline, the review step). It is
/// pinned equal to the backend catalogue, name and coverage, by
/// apps/backend/__tests__/unit/fee-service-catalogue-web-mirror.test.js, which
/// also fails if any other web or mobile source spells these words (round 5).
class FeeServiceCatalogue {
  FeeServiceCatalogue._();

  static const String phase1Name = 'งวดที่ 1 ค่าบริการตรวจสอบเอกสาร';
  static const String phase1Coverage =
      'ครอบคลุม: รับและตรวจความครบถ้วน ความถูกต้องของเอกสารคำขอตามหลักเกณฑ์ GACP · ตรวจเบื้องต้นด้วยระบบ · แจ้งผลและรับเอกสารแก้ไข · จัดเก็บเอกสารอิเล็กทรอนิกส์ · ใช้งานระบบยื่นคำขอและติดตามสถานะออนไลน์';
  static const String phase2Name = 'งวดที่ 2 ค่าบริการตรวจประเมินแปลงและออกใบรับรอง';
  static const String phase2Coverage =
      'ครอบคลุม: นัดหมายและตรวจประเมินแปลงปลูก ณ สถานที่จริง · บันทึกหลักฐานการตรวจ · ออกใบรับรองอิเล็กทรอนิกส์พร้อมลายมือชื่อดิจิทัลและ QR ตรวจสอบย้อนกลับ · ใช้งานระบบยื่นคำขอและติดตามสถานะออนไลน์';
  static const String renewalName = 'ค่าบริการต่ออายุใบรับรอง';
  static const String renewalCoverage =
      'ครอบคลุม: ตรวจประเมินเพื่อต่ออายุ · ออกใบรับรองฉบับใหม่พร้อมลายมือชื่อดิจิทัลและ QR · ใช้งานระบบยื่นคำขอและติดตามสถานะออนไลน์';
}
