import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:mobile_app/main.dart' as app;
import 'package:mobile_app/core/network/dio_client.dart';
import 'package:mobile_app/core/providers/core_providers.dart';
import 'package:mocktail/mocktail.dart';
import 'package:dio/dio.dart';

class MockDioClient extends Mock implements DioClient {}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  late MockDioClient mockClient;

  setUpAll(() async {
    // Initialize Hive for the test environment
    await Hive.initFlutter();
    await Hive.openBox('application_drafts');

    // Register fallback for Mocktail
    registerFallbackValue(RequestOptions(path: ''));
  });

  setUp(() {
    mockClient = MockDioClient();
    // Default success for post
    when(() => mockClient.post(any(), data: any(named: 'data')))
        .thenAnswer((_) async => Response(
              requestOptions: RequestOptions(path: ''),
              statusCode: 201,
              data: {
                'data': {'_id': 'mock_id_123'}
              },
            ));
  });

  testWidgets('National Standard: Smart Composite Wizard Flow (Mock Backend)',
      (WidgetTester tester) async {
    // Override ProviderScope to inject MockDioClient
    // We cannot verify 'app.main()' directly as it uses a default Scope.
    // So we pump our own scope wrapping the App widget.
    await tester.pumpWidget(ProviderScope(
      overrides: [
        dioClientProvider.overrideWithValue(mockClient),
      ],
      child: const app.MyApp(),
    ));

    await tester.pumpAndSettle();

    // 1. Start Application
    final fab = find.byType(FloatingActionButton);
    if (fab.evaluate().isNotEmpty) {
      await tester.tap(fab);
    } else {
      // Fallback if FAB is hidden or text button used
      if (find.text('New Application').evaluate().isNotEmpty) {
        await tester.tap(find.text('New Application'));
      }
    }
    await tester.pumpAndSettle();

    // Step 1: Terms
    expect(find.textContaining('ข้อตกลงและเงื่อนไข'), findsOneWidget);
    await tester.tap(find.byType(CheckboxListTile));
    await tester.pump();
    await tester.tap(find.text('ถัดไป'));
    await tester.pumpAndSettle();

    // Step 2: Applicant Info
    expect(find.textContaining('2. ข้อมูลผู้ยื่นคำขอ'), findsOneWidget);
    await tester.enterText(
        find.widgetWithText(TextFormField, 'ชื่อ-สกุล (Name - Surname)'),
        'Somchai HEALTH_USER');
    await tester.tap(find.text('ถัดไป'));
    await tester.pumpAndSettle();

    // Step 3: Site & Scope
    expect(find.textContaining('3. สถานที่และวัตถุประสงค์'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('ถัดไป'), 500);
    await tester.tap(find.text('ถัดไป'));
    await tester.pumpAndSettle();

    // Step 4: Product
    expect(find.textContaining('4. ข้อมูลการผลิต'), findsOneWidget);
    await tester.enterText(
        find.widgetWithText(TextFormField, 'ชื่อสายพันธุ์ (Strain Name)'),
        'Thai Stick');
    await tester.tap(find.text('ถัดไป'));
    await tester.pumpAndSettle();

    // Step 5: SOP
    expect(find.textContaining('5. มาตรฐานการดำเนินงาน'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('ถัดไป'), 500);
    await tester.tap(find.text('ถัดไป'));
    await tester.pumpAndSettle();

    // Step 6: Evidence (Includes Video Link Check)
    expect(find.textContaining('6. เอกสารหลักฐาน'), findsOneWidget);
    // Verify Video Link input presence
    expect(find.textContaining('Video URL'), findsOneWidget);

    // Input Video Link
    // ignore: unused_local_variable
    final linkInput =
        find.widgetWithText(TextFormField, 'https://youtube.com/...');
    // Or iterate to find the video link field specifically if label is complex
    // but the hint text is unique enough or the label
    // The label is "ลิงก์วิดีโอ (Video URL)"

    // Note: scrollUntilVisible might be needed if screen is small
    await tester.scrollUntilVisible(find.text('ถัดไป'), 500);

    await tester.tap(find.text('ถัดไป'));
    await tester.pumpAndSettle();

    // Step 7: Review & Check Submission
    expect(find.textContaining('7. สรุปและยืนยัน'), findsOneWidget);
    expect(find.text('Somchai HEALTH_USER'), findsOneWidget);

    await tester.scrollUntilVisible(
        find.text('ยืนยันและชำระเงิน (Confirm & Pay)'), 500);
    await tester.tap(find.text('ยืนยันและชำระเงิน (Confirm & Pay)'));
    await tester.pumpAndSettle();

    // Verify Payment Redirect (Mock ID)
    // If successful, we go to /applications/mock_id_123/pay1
    // The router likely shows the PaymentScreen or similar.
    // We check for "Payment" text or similar unique element of that screen.
    expect(find.textContaining('Payment'), findsOneWidget);

    // Verify API called
    verify(() =>
            mockClient.post('/applications/draft', data: any(named: 'data')))
        .called(1);
  });
}
