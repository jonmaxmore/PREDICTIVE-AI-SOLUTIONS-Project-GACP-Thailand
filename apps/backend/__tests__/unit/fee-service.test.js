/**
 * ค่าบริการต่อหนึ่งรูปแบบการปลูก คูณตามจำนวนรูปแบบที่ติ๊ก
 *
 * operator 2026-09-11: *"ไม่มีการแยกค่าธรรมเนียมรัฐ ค่าบริการ จะเป็นค่าบริการทั้งหมด
 * 5,500 + 27,500 ... รวม vat 7% จะเท่ากับ 35,310 เรามีราคานี้เท่านั้น ต่อ 1 รูปแบบการปลูก"*
 *
 * ยอดรวมในไฟล์นี้ **ไม่ขยับ**จากก่อนการเลิกแยกส่วน (105,930 / 70,620 / 141,240)
 * ที่หายไปคือช่อง stateAmount กับ platformAmount ซึ่งเคยแยก 5,500 ออกเป็น 5,000 + 500
 */
const feeService = require('../../services/fee-service');

describe('fee-service', () => {
  test('คิดตามจำนวนรูปแบบการปลูก ไม่ใช่จำนวนแปลง', () => {
    const fees = feeService.calculateApplicationFees({
      cultivationMethods: ['indoor', 'greenhouse', 'outdoor'],
      plots: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }],
    });

    expect(fees.scopeCount).toBe(3);
    // .total คือยอดเต็มของงวด (ค่าบริการ + VAT)
    expect(fees.phase1.total).toBe(17655);
    expect(fees.phase2.total).toBe(88275);
    expect(fees.phase1.serviceFeeAmount).toBe(16500);
    expect(fees.phase2.serviceFeeAmount).toBe(82500);
    expect(fees.total).toBe(105930);
    expect(fees.serviceFeeTotal).toBe(99000);
    expect(fees.vatTotal).toBe(6930);
    expect(fees.grandTotal).toBe(105930);
  });

  test('เดาจำนวนรูปแบบจากระบบปลูกที่ไม่ซ้ำกันในแปลง เมื่อไม่ได้ระบุ cultivationMethods', () => {
    const fees = feeService.calculateApplicationFees({
      plots: [
        { solarSystem: 'outdoor' },
        { solarSystem: 'outdoor' },
        { solarSystem: 'greenhouse' },
      ],
    });

    expect(fees.scopeCount).toBe(2);
    expect(fees.phase1.total).toBe(11770);
    expect(fees.phase2.total).toBe(58850);
    expect(fees.phase1.serviceFeeAmount).toBe(11000);
    expect(fees.phase2.serviceFeeAmount).toBe(55000);
    expect(fees.grandTotal).toBe(70620);
  });

  test('scopeCount ที่ส่งมาตรง ๆ ชนะค่าที่อยู่ใน payload', () => {
    const fees = feeService.calculateApplicationFees(
      {
        cultivationMethods: ['outdoor'],
        totalAreaTypes: 1,
      },
      { scopeCount: 4 },
    );

    expect(fees.scopeCount).toBe(4);
    expect(fees.phase1.total).toBe(23540);
    expect(fees.phase2.total).toBe(117700);
    expect(fees.phase1.serviceFeeAmount).toBe(22000);
    expect(fees.phase2.serviceFeeAmount).toBe(110000);
    expect(fees.grandTotal).toBe(141240);
  });

  test('ไม่มีช่องที่แยกส่วนหลงเหลือ', () => {
    const fees = feeService.calculateApplicationFees({ cultivationMethods: ['outdoor'] });
    expect(fees.stateTotal).toBeUndefined();
    expect(fees.platformTotal).toBeUndefined();
    expect(fees.phase1.stateAmount).toBeUndefined();
    expect(fees.phase1.platformAmount).toBeUndefined();
  });
});
