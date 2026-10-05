import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/presentation/features/application/screens/wizard_steps/step_4_application_data.dart';
import 'package:mobile_app/presentation/features/application/screens/wizard_steps/step_7_documents.dart';
import 'package:mobile_app/presentation/features/application/screens/wizard_steps/step_8_review.dart';

/// Regression guard: every wizard step must RENDER without a layout exception.
/// (Review finding: Expanded(ListView/TabBarView) inside WizardScaffold's
/// SingleChildScrollView>Column throws "children have non-zero flex but
/// incoming height constraints are unbounded" — a deterministic crash.)
Future<void> pumpStep(WidgetTester tester, Widget step) async {
  await tester.pumpWidget(
    ProviderScope(child: MaterialApp(home: step)),
  );
  // Any layout exception surfaces via takeException.
  expect(tester.takeException(), isNull);
}

void main() {
  testWidgets('Step 4 (application data) renders without layout exception',
      (tester) async {
    await pumpStep(tester, const Step4ApplicationData());
  });

  testWidgets('Step 7 (documents) renders without layout exception',
      (tester) async {
    await pumpStep(tester, const Step7Documents());
  });

  testWidgets('Step 8 (review) renders without layout exception',
      (tester) async {
    await pumpStep(tester, const Step8Review());
  });
}
