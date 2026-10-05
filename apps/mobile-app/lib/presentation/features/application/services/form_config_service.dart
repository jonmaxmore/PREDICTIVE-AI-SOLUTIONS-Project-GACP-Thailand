class FormConfigService {
  static const Map<String, String> herbTypeLabels = {
    'CANNABIS': 'กัญชง/กัญชา (Cannabis/Hemp)',
    'TURMERIC': 'ขมิ้นชัน (Turmeric)',
    'GINGER': 'ขิง (Ginger)',
    'BLACK_GALINGALE': 'กระชายดำ (Black Galingale)',
    'PLAI': 'ไพล (Plai)',
    'KRATOM': 'กระท่อม (Kratom)',
  };

  static List<Map<String, dynamic>> getReplacementDocumentList({
    required String reason,
    required String applicantType,
  }) {
    final commonDocs = [
      {
        'id': 'REQ_FORM',
        'title': '1. แบบลงทะเบียนยื่นคำขอ',
        'description': 'อัปโหลด 1 ไฟล์ (PDF)',
        'maxSize': '100 MB',
        'required': true,
        'hasDownload': true,
        'isLink': false
      },
      {
        'id': 'LAND_TITLE',
        'title': '2. สำเนาหนังสือแสดงกรรมสิทธิ์ในที่ดิน',
        'description': 'อัปโหลด 1 ไฟล์ (PDF)',
        'maxSize': '100 MB',
        'required': true,
        'isLink': false
      },
      {
        'id': 'LAND_CONSENT',
        'title': '3. หนังสือให้ความยินยอม (กรณีเช่า)',
        'description': 'อัปโหลด 1 ไฟล์ (PDF)',
        'maxSize': '100 MB',
        'required': false,
        'isLink': false
      },
      {
        'id': 'MAP_GPS',
        'title': '4. แผนที่แสดงที่ตั้งและพิกัด',
        'description': 'อัปโหลด 1 ไฟล์ (PDF)',
        'maxSize': '100 MB',
        'required': true,
        'isLink': false
      },
      {
        'id': 'BUILDING_PLAN',
        'title': '5. แบบแปลนอาคารหรือโรงเรือน',
        'description': 'อัปโหลด 1 ไฟล์ (PDF)',
        'maxSize': '100 MB',
        'required': true,
        'isLink': false
      },
      {
        'id': 'EXTERIOR_PHOTO',
        'title': '6. ภาพถ่ายบริเวณภายนอกอาคาร',
        'description': 'อัปโหลด 1 ไฟล์ (PDF หรือรูปภาพ)',
        'maxSize': '100 MB',
        'required': true,
        'isLink': false
      },
      {
        'id': 'PROD_PLAN',
        'title': '7. แผนการผลิตกัญชาแต่ละรอบ/ปี',
        'description': 'อัปโหลด 1 ไฟล์ (PDF)',
        'maxSize': '100 MB',
        'required': true,
        'isLink': false
      },
      {
        'id': 'SECURITY_PLAN',
        'title': '8. มาตรการรักษาความปลอดภัย',
        'description': 'อัปโหลด 1 ไฟล์ (PDF)',
        'maxSize': '100 MB',
        'required': true,
        'isLink': false
      },
      {
        'id': 'INTERIOR_PHOTO',
        'title': '9. ภาพถ่ายภายในสถานที่ผลิต',
        'description': 'อัปโหลด 1 ไฟล์ (PDF หรือรูปภาพ)',
        'maxSize': '100 MB',
        'required': true,
        'isLink': false
      },
      {
        'id': 'SOP',
        'title': '10. คู่มือมาตรฐานการปฏิบัติงาน (SOP)',
        'description': 'ฉบับภาษาไทยเท่านั้น อัปโหลด 1 ไฟล์ (PDF)',
        'maxSize': '1 GB',
        'required': true,
        'isLink': false
      },
    ];

    final List<Map<String, dynamic>> specialDocs = [];
    if (reason == 'LOST') {
      specialDocs.add({
        'id': 'POLICE_REPORT',
        'title': 'ใบแจ้งความ (Police Report)',
        'description': 'กรณีใบรับรองสูญหาย อัปโหลด 1 ไฟล์',
        'maxSize': '10 MB',
        'required': true,
        'isLink': false
      });
    } else if (reason == 'DAMAGED') {
      specialDocs.add({
        'id': 'ORIGINAL_CERT_PHYSICAL',
        'title': 'ใบรับรองฉบับเดิม (Original Certificate)',
        'description': 'กรณีชำรุด อัปโหลด 1 ไฟล์',
        'maxSize': '10 MB',
        'required': true,
        'isLink': false
      });
    }

    return [...specialDocs, ...commonDocs];
  }

  static List<Map<String, dynamic>> getRenewalDocumentList({
    required String applicantType,
  }) {
    // 1-10 are common for all
    final commonDocs = [
      {
        'id': 'REQ_FORM',
        'title': '1. แบบลงทะเบียนยื่นคำขอ',
        'description':
            'ดาวน์โหลดแบบฟอร์มและแนบกลับ (Upload PDF). ตัวอย่างวิดีโอ (แนบลิงค์)',
        'required': true,
        'maxSize': '100 MB',
        'types': ['PDF'],
        'hasDownload': true,
        'hasVideo': true,
        'videoLink': 'https://youtu.be/example'
      },
      {
        'id': 'LAND_TITLE',
        'title': '2. สำเนาหนังสือแสดงกรรมสิทธิ์ในที่ดิน/สิทธิครอบครอง',
        'required': true,
        'maxSize': '100 MB',
        'types': ['PDF']
      },
      {
        'id': 'LAND_CONSENT',
        'title': '3. หนังสือให้ความยินยอม (กรณีเช่า/ใช้ที่ดินผู้อื่น)',
        'required': false, // Contextual
        'maxSize': '100 MB',
        'types': ['PDF']
      },
      {
        'id': 'MAP_GPS',
        'title': '4. แผนที่แสดงที่ตั้งและพิกัด (Map & Coordinates)',
        'description':
            'เส้นทางเข้าถึง, พิกัดแปลง, ขนาดแปลง, สิ่งปลูกสร้างใกล้เคียง',
        'required': true,
        'maxSize': '100 MB',
        'types': ['PDF', 'Image']
      },
      {
        'id': 'BUILDING_PLAN',
        'title': '5. แบบแปลนอาคารหรือโรงเรือน',
        'required': true,
        'maxSize': '100 MB',
        'types': ['PDF']
      },
      {
        'id': 'EXTERIOR_PHOTO',
        'title': '6. ภาพถ่ายบริเวณภายนอกอาคาร/โรงเรือน',
        'required': true,
        'maxSize': '100 MB',
        'types': ['PDF', 'Image']
      },
      {
        'id': 'PROD_PLAN_DOC',
        'title': '7. แผนการผลิตกัญชาแต่ละรอบ/ปี และแผนการใช้ประโยชน์',
        'required': true,
        'maxSize': '100 MB',
        'types': ['PDF']
      },
      {
        'id': 'SECURITY_PLAN_DOC',
        'title': '8. มาตรการรักษาความปลอดภัย และการจัดการส่วนที่เหลือ',
        'required': true,
        'maxSize': '100 MB',
        'types': ['PDF']
      },
      {
        'id': 'INTERIOR_PHOTO',
        'title': '9. ภาพถ่ายภายในสถานที่ผลิตและเก็บเกี่ยว',
        'required': true,
        'maxSize': '100 MB',
        'types': ['PDF', 'Image']
      },
      {
        'id': 'SOP_FULL',
        'title': '10. คู่มือมาตรฐานการปฏิบัติงาน (SOP) ฉบับภาษาไทย',
        'description': 'ระบุละเอียดทุกขั้นตอน. Upload PDF.',
        'required': true,
        'maxSize': '1 GB',
        'types': ['PDF']
      },
    ];

    // Individual Specific (Subset for this example, full list would ideally be here)
    final individualDocs = [
      {
        'id': 'TRAINING_CERT',
        'title': '11. หนังสือรับรองการฝึกอบรม (E-learning GACP)',
        'required': true,
        'maxSize': '100 MB',
        'types': ['PDF', 'Image']
      },
      {
        'id': 'STRAIN_CERT',
        'title': '12. หนังสือรับรองสายพันธุ์',
        'required': true,
        'maxSize': '100 MB',
        'types': ['PDF']
      },
      {
        'id': 'VIDEO_LINK',
        'title': '24. วิดีโอแสดงสถานที่การปฏิบัติงาน (แนบลิงค์)',
        'required': true,
        'maxSize': 'Link',
        'isLink': true
      },
    ];

    // Community/Juristic placeholders to match structure
    final communityDocs = individualDocs;
    final juristicDocs = individualDocs;

    // Prepend 'OLD_CERT'
    final oldCertDoc = {
      'id': 'ORIGINAL_OLD_CERT',
      'title': '0. ต้นฉบับใบรับรองเก่า (Original Old Certificate)',
      'required': true,
      'maxSize': '10 MB',
      'types': ['PDF', 'Image']
    };

    List<Map<String, dynamic>> selectedList;
    if (applicantType == 'COMMUNITY') {
      selectedList = [...commonDocs, ...communityDocs];
    } else if (applicantType == 'JURISTIC') {
      selectedList = [...commonDocs, ...juristicDocs];
    } else {
      selectedList = [...commonDocs, ...individualDocs];
    }

    return [oldCertDoc, ...selectedList];
  }
}
