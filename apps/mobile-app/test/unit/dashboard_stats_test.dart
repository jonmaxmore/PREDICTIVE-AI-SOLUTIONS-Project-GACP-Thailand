// Unit tests for dashboard stat derivation from REAL /applications/my rows
// (M4b: replaces the hardcoded totalApplications=2 consts).
// Definitions (task DoD):
//   total     = all applications
//   pending   = status NOT in {CERTIFIED, APPROVED, REJECTED, EXPIRED}
//   certified = hasCertificate == true OR status == CERTIFIED
//   expired   = status == EXPIRED
//   latest    = newest by createdAt
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/domain/entities/application_entity.dart';
import 'package:mobile_app/presentation/features/dashboard/dashboard_stats.dart';

ApplicationEntity app({
  required String id,
  required String status,
  bool hasCertificate = false,
  String dashboardStage = '',
  String applicationNumber = '',
  required DateTime createdAt,
}) {
  return ApplicationEntity(
    id: id,
    type: 'NEW_APPLICATION',
    status: status,
    establishmentId: '',
    establishmentName: '',
    applicationNumber: applicationNumber,
    dashboardStage: dashboardStage,
    hasCertificate: hasCertificate,
    documents: const [],
    createdAt: createdAt,
  );
}

void main() {
  test('empty list → all zeros, no latest', () {
    final stats = DashboardStats.fromApplications(const []);
    expect(stats.total, 0);
    expect(stats.pending, 0);
    expect(stats.certified, 0);
    expect(stats.expired, 0);
    expect(stats.latest, isNull);
  });

  test('counts follow the DoD definitions', () {
    final apps = [
      app(id: 'a', status: 'PENDING_DOC_FEE', createdAt: DateTime(2026, 1, 1)),
      app(
          id: 'b',
          status: 'CERTIFIED',
          hasCertificate: true,
          createdAt: DateTime(2026, 2, 1)),
      app(id: 'c', status: 'EXPIRED', createdAt: DateTime(2026, 3, 1)),
      app(id: 'd', status: 'REJECTED', createdAt: DateTime(2026, 4, 1)),
      app(id: 'e', status: 'ASSIGNED_FOR_REVIEW', createdAt: DateTime(2026, 5, 1)),
    ];
    final stats = DashboardStats.fromApplications(apps);
    expect(stats.total, 5);
    expect(stats.pending, 2, reason: 'a + e (not CERTIFIED/APPROVED/REJECTED/EXPIRED)');
    expect(stats.certified, 1);
    expect(stats.expired, 1);
  });

  test('hasCertificate counts as certified even before status flips', () {
    final stats = DashboardStats.fromApplications([
      app(
          id: 'a',
          status: 'APPROVED',
          hasCertificate: true,
          createdAt: DateTime(2026, 1, 1)),
    ]);
    expect(stats.certified, 1);
    expect(stats.pending, 0, reason: 'APPROVED is not pending');
  });

  test('status matching is case-insensitive (backend stores raw states)', () {
    final stats = DashboardStats.fromApplications([
      app(id: 'a', status: 'expired', createdAt: DateTime(2026, 1, 1)),
    ]);
    expect(stats.expired, 1);
    expect(stats.pending, 0);
  });

  test('latest = newest by createdAt regardless of list order', () {
    final stats = DashboardStats.fromApplications([
      app(
          id: 'old',
          status: 'CERTIFIED',
          applicationNumber: 'GACP-OLD',
          createdAt: DateTime(2025, 1, 1)),
      app(
          id: 'new',
          status: 'PENDING_DOC_FEE',
          applicationNumber: 'GACP-NEW',
          createdAt: DateTime(2026, 6, 1)),
      app(
          id: 'mid',
          status: 'DRAFT',
          applicationNumber: 'GACP-MID',
          createdAt: DateTime(2026, 1, 1)),
    ]);
    expect(stats.latest?.applicationNumber, 'GACP-NEW');
  });
}
