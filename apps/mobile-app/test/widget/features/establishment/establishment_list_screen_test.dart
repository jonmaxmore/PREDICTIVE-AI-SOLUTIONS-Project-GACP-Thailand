import 'package:dartz/dartz.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:mobile_app/domain/entities/establishment_entity.dart';
import 'package:mobile_app/domain/repositories/establishment_repository.dart';
import 'package:mobile_app/presentation/features/establishment/providers/establishment_provider.dart';
import 'package:mobile_app/presentation/features/establishment/screens/establishment_list_screen.dart';

class MockEstablishmentRepository extends Mock
    implements EstablishmentRepository {}

void main() {
  late MockEstablishmentRepository mockRepo;

  setUp(() {
    mockRepo = MockEstablishmentRepository();
  });

  Widget createWidgetUnderTest() {
    return ProviderScope(
      overrides: [
        establishmentRepositoryProvider.overrideWithValue(mockRepo),
      ],
      child: const MaterialApp(
        home: EstablishmentListScreen(),
      ),
    );
  }

  final tEstablishment = EstablishmentEntity(
    id: '123',
    name: 'Apple Farm',
    type: 'Indoor',
    address: 'Cupertino',
    status: 'Active',
    licenseNumber: 'GACP-2025-ABCD',
    updatedAt: DateTime.now(),
    licenseExpiredAt: DateTime.now().add(const Duration(days: 365)),
  );

  testWidgets('Mobile View: Renders ListTile correctly (Width < 900)',
      (tester) async {
    // Arrange
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1.0;
    when(() => mockRepo.getEstablishments())
        .thenAnswer((_) async => Right([tEstablishment]));
    when(() => mockRepo.deleteEstablishment(any()))
        .thenAnswer((_) async => const Right(null));

    // Act
    await tester.pumpWidget(createWidgetUnderTest());
    await tester.pumpAndSettle();

    // Assert
    expect(find.text('Apple Farm'), findsOneWidget); // Tile Title
    expect(find.text('Indoor'), findsOneWidget); // Tile Subtitle
    expect(
        find.byType(DataTable), findsNothing); // Should NOT show Desktop Table

    // Cleanup
    addTearDown(tester.view.resetPhysicalSize);
  });

  testWidgets('Desktop View: Renders DataTable correctly (Width > 900)',
      (tester) async {
    // Arrange
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1.0;
    when(() => mockRepo.getEstablishments())
        .thenAnswer((_) async => Right([tEstablishment]));
    when(() => mockRepo.deleteEstablishment(any()))
        .thenAnswer((_) async => const Right(null));

    // Act
    await tester.pumpWidget(createWidgetUnderTest());
    await tester.pumpAndSettle();

    // Assert
    expect(find.text('Apple Farm'), findsOneWidget);
    expect(find.text('GACP-2025-ABCD'),
        findsOneWidget); // Specific to Desktop Table New Column
    expect(find.byType(DataTable), findsOneWidget);

    // Cleanup
    addTearDown(tester.view.resetPhysicalSize);
  });
}
