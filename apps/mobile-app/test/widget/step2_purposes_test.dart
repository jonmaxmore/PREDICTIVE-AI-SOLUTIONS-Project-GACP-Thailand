import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/presentation/features/application/providers/form_state_provider.dart';
import 'package:mobile_app/presentation/features/application/screens/wizard_steps/step_2_request_type.dart';

/// Step 2 asks the purpose (operator ruling 2026-10-05): exactly the three words a ภ.ท.
/// licence backs, each labelled with its licence code, and nothing pre-ticked.
void main() {
  Future<ProviderContainer> pump(WidgetTester tester) async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: const MaterialApp(home: Step2RequestType()),
    ));
    expect(tester.takeException(), isNull);
    return container;
  }

  testWidgets('offers the three purposes with their licence codes, none ticked',
      (tester) async {
    final container = await pump(tester);
    expect(find.text('ศึกษาวิจัย (ภ.ท. 09)'), findsOneWidget);
    expect(find.text('ส่งออกเพื่อการค้า (ภ.ท. 10)'), findsOneWidget);
    expect(find.text('แปรรูปหรือจำหน่ายเพื่อการค้า (ภ.ท. 11)'), findsOneWidget);
    expect(find.textContaining('ทางการแพทย์'), findsNothing);
    expect(container.read(applicationFormProvider).certificationPurposes,
        isEmpty);
  });

  testWidgets('tapping ticks and unticks, in the vocabulary order',
      (tester) async {
    final container = await pump(tester);
    await tester.ensureVisible(find.byKey(const ValueKey('purpose-PROCESSING')));
    await tester.tap(find.byKey(const ValueKey('purpose-PROCESSING')));
    await tester.ensureVisible(find.byKey(const ValueKey('purpose-RESEARCH')));
    await tester.tap(find.byKey(const ValueKey('purpose-RESEARCH')));
    await tester.pump();
    expect(container.read(applicationFormProvider).certificationPurposes,
        ['RESEARCH', 'PROCESSING']);
    await tester.tap(find.byKey(const ValueKey('purpose-RESEARCH')));
    await tester.pump();
    expect(container.read(applicationFormProvider).certificationPurposes,
        ['PROCESSING']);
  });

  testWidgets('a word outside the vocabulary is never accepted', (tester) async {
    final container = await pump(tester);
    container.read(applicationFormProvider.notifier).togglePurpose('MEDICAL');
    container.read(applicationFormProvider.notifier).togglePurpose('COMMERCIAL');
    expect(container.read(applicationFormProvider).certificationPurposes,
        isEmpty);
  });
}
