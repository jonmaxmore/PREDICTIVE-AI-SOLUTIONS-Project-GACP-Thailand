import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/presentation/features/application/services/payment_service.dart';

/// One service fee (operator 2026-09-11, re-ruled 2026-10-03): the payment read
/// model carries ค่าบริการ + VAT + total per instalment, the catalogue name and
/// coverage, all from GET /applications/:id/quotations — never a DTAM part and a
/// platform part.
void main() {
  Map<String, dynamic> newFiling({bool accepted = false}) => {
        'dtam': null,
        'platform': {
          'quotationNumber': 'QT-PRD-2569-000001',
          'status': accepted ? 'ACCEPTED' : 'PENDING',
          'totalAmount': '35310.00',
          'installments': [
            {'phase': 'PHASE_1', 'amount': 5885, 'serviceFeeAmount': '5500.00', 'vatAmount': '385.00'},
            {'phase': 'PHASE_2', 'amount': 29425, 'serviceFeeAmount': 27500, 'vatAmount': 1925, 'phaseTotal': '29425.00'},
          ],
        },
        'copy': {
          'services': {
            'PHASE_1': {'name': 'งวดที่ 1 ค่าบริการตรวจสอบเอกสาร', 'coverage': 'ครอบคลุม: ก'},
            'PHASE_2': {'name': 'งวดที่ 2 ค่าบริการตรวจประเมินแปลงและออกใบรับรอง', 'coverage': 'ครอบคลุม: ข'},
            'VAT': {'name': 'ภาษีมูลค่าเพิ่ม 7% คิดจากค่าบริการทั้งจำนวน'},
          },
        },
      };

  group('QuotationView.fromApi', () {
    test('reads one service fee + VAT + total per instalment (Decimal strings too)', () {
      final q = QuotationView.fromApi(newFiling())!;
      expect(q.phases['PHASE_1']!.serviceFee, 5500);
      expect(q.phases['PHASE_1']!.vat, 385);
      expect(q.phases['PHASE_1']!.total, 5885);
      expect(q.phases['PHASE_2']!.total, 29425);
      expect(q.isAccepted, isFalse);
      expect(q.isRenewal, isFalse);
    });

    test('names each instalment from the served catalogue, VAT from the served rate', () {
      final q = QuotationView.fromApi(newFiling())!;
      expect(q.services['PHASE_1']!.name, 'งวดที่ 1 ค่าบริการตรวจสอบเอกสาร');
      expect(q.services['PHASE_2']!.coverage, 'ครอบคลุม: ข');
      expect(q.vatName, 'ภาษีมูลค่าเพิ่ม 7% คิดจากค่าบริการทั้งจำนวน');
    });

    test('a renewal has no instalment 1 and names the renewal service', () {
      final data = newFiling();
      data['copy'] = <String, dynamic>{
        'services': <String, dynamic>{
          'PHASE_1': null,
          'PHASE_2': {'name': 'ค่าบริการต่ออายุใบรับรอง', 'coverage': 'ครอบคลุม: ค'},
        },
      };
      final q = QuotationView.fromApi(data)!;
      expect(q.isRenewal, isTrue);
      expect(q.services['PHASE_2']!.name, 'ค่าบริการต่ออายุใบรับรอง');
    });

    test('the accepted snapshot is the figure of record', () {
      final data = newFiling(accepted: true);
      data['platform'] = <String, dynamic>{...(data['platform'] as Map<String, dynamic>)};
      (data['platform'] as Map<String, dynamic>)['acceptedSnapshot'] = <String, dynamic>{
        'installments': [
          {'phase': 'PHASE_1', 'serviceFeeAmount': '4000.00', 'vatAmount': '280.00', 'phaseTotal': '4280.00'},
        ],
      };
      final q = QuotationView.fromApi(data)!;
      expect(q.isAccepted, isTrue);
      expect(q.phases['PHASE_1']!.total, 4280);
    });

    test('ACCEPTED and INVOICED both count as accepted (kept from the old suite)', () {
      for (final st in ['ACCEPTED', 'INVOICED']) {
        final data = newFiling();
        data['platform'] = <String, dynamic>{...(data['platform'] as Map<String, dynamic>), 'status': st};
        expect(QuotationView.fromApi(data)!.isAccepted, isTrue, reason: st);
      }
    });

    test('no row yet = no quotation', () {
      expect(QuotationView.fromApi({'dtam': null, 'platform': null}), isNull);
    });
  });

  group('InvoiceInfo.fromMap', () {
    test('a checkout invoice: subtotal + VAT + total, Decimal strings parsed', () {
      final inv = InvoiceInfo.fromMap({
        'id': 'inv-1',
        'invoiceNumber': 'INV-CO-ABCD1234-M1',
        'applicationId': 'app-1',
        'serviceType': 'CERTIFICATION_CHECKOUT_M1',
        'subtotal': '5500.00',
        'vat': '385.00',
        'totalAmount': '5885.00',
        'status': 'pending',
      });
      expect(inv.subtotal, 5500);
      expect(inv.vat, 385);
      expect(inv.totalAmount, 5885);
      expect(inv.isPaid, isFalse);
    });

    test('paid statuses', () {
      for (final s in ['PAID', 'paid', 'RECEIPT_ISSUED']) {
        expect(InvoiceInfo.fromMap({'status': s}).isPaid, isTrue, reason: s);
      }
    });

    test('falls back to the nested application.id shape (kept from the old suite)', () {
      final inv = InvoiceInfo.fromMap({
        'id': 'x',
        'serviceType': 'CERTIFICATION_CHECKOUT_M1',
        'totalAmount': 1,
        'status': 'pending',
        'application': {'id': 'app-9'},
      });
      expect(inv.applicationId, 'app-9');
    });

    test('phase → checkout milestone', () {
      expect(milestoneOfPhase('PHASE_1'), 'M1');
      expect(milestoneOfPhase('PHASE_2'), 'M2');
    });
  });
}
