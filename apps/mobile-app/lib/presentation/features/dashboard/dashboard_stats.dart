import '../../../domain/entities/application_entity.dart';

/// Dashboard stat counts derived client-side from GET /applications/my rows.
/// (GET /applications/dashboard does NOT exist on the backend — do not add
/// an endpoint call for this.)
class DashboardStats {
  final int total;

  /// Not yet terminal: status NOT in {CERTIFIED, APPROVED, REJECTED, EXPIRED}.
  final int pending;

  /// hasCertificate == true OR status == CERTIFIED.
  final int certified;

  /// status == EXPIRED.
  final int expired;

  /// Newest application by createdAt (null when the user has none).
  final ApplicationEntity? latest;

  const DashboardStats({
    required this.total,
    required this.pending,
    required this.certified,
    required this.expired,
    required this.latest,
  });

  static const Set<String> _terminal = {
    'CERTIFIED',
    'APPROVED',
    'REJECTED',
    'EXPIRED',
  };

  factory DashboardStats.fromApplications(List<ApplicationEntity> apps) {
    var pending = 0, certified = 0, expired = 0;
    ApplicationEntity? latest;

    for (final app in apps) {
      final status = app.status.trim().toUpperCase();
      if (!_terminal.contains(status)) pending++;
      if (app.hasCertificate || status == 'CERTIFIED') certified++;
      if (status == 'EXPIRED') expired++;
      if (latest == null || app.createdAt.isAfter(latest.createdAt)) {
        latest = app;
      }
    }

    return DashboardStats(
      total: apps.length,
      pending: pending,
      certified: certified,
      expired: expired,
      latest: latest,
    );
  }
}
