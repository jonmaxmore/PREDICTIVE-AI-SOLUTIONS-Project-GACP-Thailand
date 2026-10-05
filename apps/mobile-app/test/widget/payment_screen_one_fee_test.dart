import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/core/network/dio_client.dart';
import 'package:mobile_app/presentation/features/application/screens/payment_screen.dart';
import 'package:mobile_app/presentation/features/application/services/payment_service.dart';

/// One service fee on the mobile payment screen (operator 2026-09-11, re-ruled
/// 2026-10-03): the instalment's served name + coverage, its ค่าบริการ, the VAT
/// line named with the served rate, and the total — never a DTAM part or a
/// platform part. A renewal names the renewal service.
class _FakePaymentService extends PaymentService {
  final QuotationView? quotation;
  final InvoiceInfo? invoice;
  _FakePaymentService(this.quotation, this.invoice)
      : super(DioClient(const FlutterSecureStorage()));

  @override
  Future<QuotationView?> getQuotation(String applicationId) async => quotation;

  @override
  Future<InvoiceInfo?> getPhaseInvoice(String applicationId, String phase) async =>
      invoice;
}

Map<String, dynamic> _data({required bool renewal}) => <String, dynamic>{
      'platform': <String, dynamic>{
        'quotationNumber': 'QT-PRD-2569-000009',
        'status': 'PENDING',
        'installments': renewal
            ? [
                {'phase': 'PHASE_2', 'amount': 70620, 'serviceFeeAmount': 66000, 'vatAmount': 4620},
              ]
            : [
                {'phase': 'PHASE_1', 'amount': 5885, 'serviceFeeAmount': 5500, 'vatAmount': 385},
                {'phase': 'PHASE_2', 'amount': 29425, 'serviceFeeAmount': 27500, 'vatAmount': 1925},
              ],
      },
      'copy': <String, dynamic>{
        'services': <String, dynamic>{
          'PHASE_1': renewal
              ? null
              : {'name': 'งวดที่ 1 ค่าบริการตรวจสอบเอกสาร', 'coverage': 'ครอบคลุม: ตรวจเอกสาร'},
          'PHASE_2': renewal
              ? {'name': 'ค่าบริการต่ออายุใบรับรอง', 'coverage': 'ครอบคลุม: ตรวจเพื่อต่ออายุ'}
              : {'name': 'งวดที่ 2 ค่าบริการตรวจประเมินแปลงและออกใบรับรอง', 'coverage': 'ครอบคลุม: ตรวจแปลง'},
          'VAT': {'name': 'ภาษีมูลค่าเพิ่ม 7% คิดจากค่าบริการทั้งจำนวน'},
        },
      },
    };

Future<void> _pump(WidgetTester tester, PaymentService service, String phase) async {
  await tester.pumpWidget(ProviderScope(
    overrides: [paymentServiceProvider.overrideWithValue(service)],
    child: MaterialApp(home: PaymentScreen(applicationId: 'app-1', phase: phase)),
  ));
  await tester.pumpAndSettle();
  expect(tester.takeException(), isNull);
}

void main() {
  testWidgets('new filing phase 1: name, coverage, fee, VAT, total — no split', (tester) async {
    await _pump(tester, _FakePaymentService(QuotationView.fromApi(_data(renewal: false)), null), 'PHASE_1');
    expect(find.text('งวดที่ 1 ค่าบริการตรวจสอบเอกสาร'), findsWidgets);
    expect(find.text('ครอบคลุม: ตรวจเอกสาร'), findsOneWidget);
    expect(find.text('5,500.00 บาท'), findsOneWidget);
    expect(find.text('ภาษีมูลค่าเพิ่ม 7% คิดจากค่าบริการทั้งจำนวน'), findsOneWidget);
    expect(find.text('385.00 บาท'), findsOneWidget);
    expect(find.text('5,885.00 บาท'), findsOneWidget);
    expect(find.textContaining('DTAM'), findsNothing);
    expect(find.textContaining('แพลตฟอร์ม'), findsNothing);
    expect(find.textContaining('ค่าธรรมเนียม'), findsNothing);
  });

  testWidgets('renewal: the renewal service and its one charge', (tester) async {
    await _pump(tester, _FakePaymentService(QuotationView.fromApi(_data(renewal: true)), null), 'PHASE_2');
    expect(find.text('ค่าบริการต่ออายุใบรับรอง'), findsWidgets);
    expect(find.text('ครอบคลุม: ตรวจเพื่อต่ออายุ'), findsOneWidget);
    expect(find.text('66,000.00 บาท'), findsOneWidget);
    expect(find.text('4,620.00 บาท'), findsOneWidget);
    expect(find.text('70,620.00 บาท'), findsOneWidget);
    expect(find.textContaining('งวดที่ 2'), findsNothing);
  });

  testWidgets('an issued invoice shows its own fee, VAT and total', (tester) async {
    final invoice = InvoiceInfo.fromMap({
      'id': 'inv-1', 'invoiceNumber': 'INV-CO-AAAA0001-M2', 'applicationId': 'app-1',
      'serviceType': 'CERTIFICATION_CHECKOUT_M2', 'subtotal': '66000.00', 'vat': '4620.00',
      'totalAmount': '70620.00', 'status': 'pending',
    });
    await _pump(tester, _FakePaymentService(QuotationView.fromApi(_data(renewal: true)), invoice), 'PHASE_2');
    expect(find.text('ใบแจ้งหนี้เลขที่ INV-CO-AAAA0001-M2'), findsOneWidget);
    expect(find.text('70,620.00 บาท'), findsNWidgets(2));
    expect(find.text('รอชำระ'), findsOneWidget);
  });
}
