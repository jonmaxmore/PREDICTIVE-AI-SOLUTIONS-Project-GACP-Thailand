import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import '../services/api_service.dart';

/// Offline Mode Provider
/// Tracks network connectivity state
final offlineModeProvider = StateProvider<bool>((ref) => false);

/// Connectivity Stream Provider
final connectivityProvider = StreamProvider<ConnectivityResult>((ref) {
  return Connectivity().onConnectivityChanged;
});

/// Initialize connectivity monitoring
void initConnectivityMonitoring(Ref ref) {
  Connectivity().onConnectivityChanged.listen((result) {
    final isOffline = result == ConnectivityResult.none;
    ref.read(offlineModeProvider.notifier).state = isOffline;

    if (!isOffline) {
      // Trigger sync when back online
      ref.read(offlineStorageProvider.notifier).syncPendingData();
    }
  });
}

/// Offline Storage Provider
/// Manages local storage and sync of offline data
final offlineStorageProvider =
    StateNotifierProvider<OfflineStorageNotifier, OfflineStorageState>(
  (ref) => OfflineStorageNotifier(ref),
);

class OfflineStorageState {
  final List<PendingScan> pendingScans;
  final List<PendingCultivationLog> pendingLogs;
  final bool isSyncing;
  final int lastSyncTimestamp;

  const OfflineStorageState({
    this.pendingScans = const [],
    this.pendingLogs = const [],
    this.isSyncing = false,
    this.lastSyncTimestamp = 0,
  });

  OfflineStorageState copyWith({
    List<PendingScan>? pendingScans,
    List<PendingCultivationLog>? pendingLogs,
    bool? isSyncing,
    int? lastSyncTimestamp,
  }) {
    return OfflineStorageState(
      pendingScans: pendingScans ?? this.pendingScans,
      pendingLogs: pendingLogs ?? this.pendingLogs,
      isSyncing: isSyncing ?? this.isSyncing,
      lastSyncTimestamp: lastSyncTimestamp ?? this.lastSyncTimestamp,
    );
  }

  int get pendingCount => pendingScans.length + pendingLogs.length;
  bool get hasPendingData => pendingCount > 0;
}

class OfflineStorageNotifier extends StateNotifier<OfflineStorageState> {
  OfflineStorageNotifier(this._ref) : super(const OfflineStorageState()) {
    _loadPendingData();
  }

  final Ref _ref;

  static const String _scansKey = 'pending_scans';
  static const String _logsKey = 'pending_logs';
  static const String _lastSyncKey = 'last_sync';

  /// Load pending data from local storage
  Future<void> _loadPendingData() async {
    final prefs = await SharedPreferences.getInstance();

    final scansJson = prefs.getStringList(_scansKey) ?? [];
    final logsJson = prefs.getStringList(_logsKey) ?? [];

    final scans = scansJson
        .map((json) => PendingScan.fromJson(jsonDecode(json)))
        .toList();

    final logs = logsJson
        .map((json) => PendingCultivationLog.fromJson(jsonDecode(json)))
        .toList();

    state = state.copyWith(
      pendingScans: scans,
      pendingLogs: logs,
      lastSyncTimestamp: prefs.getInt(_lastSyncKey) ?? 0,
    );
  }

  /// Save a scan for later sync
  Future<void> saveScan(PendingScan scan) async {
    final prefs = await SharedPreferences.getInstance();

    final scans = [...state.pendingScans, scan];
    final scansJson = scans.map((s) => jsonEncode(s.toJson())).toList();

    await prefs.setStringList(_scansKey, scansJson);

    state = state.copyWith(pendingScans: scans);
  }

  /// Save a cultivation log for later sync
  Future<void> saveCultivationLog(PendingCultivationLog log) async {
    final prefs = await SharedPreferences.getInstance();

    final logs = [...state.pendingLogs, log];
    final logsJson = logs.map((l) => jsonEncode(l.toJson())).toList();

    await prefs.setStringList(_logsKey, logsJson);

    state = state.copyWith(pendingLogs: logs);
  }

  /// Sync all pending data to server
  Future<SyncResult> syncPendingData() async {
    if (state.isSyncing || (!state.hasPendingData)) {
      return SyncResult.nothingToSync;
    }

    state = state.copyWith(isSyncing: true);

    try {
      // TODO: Implement actual API calls
      final results = await _performSync();

      // Clear successfully synced items
      await _clearSyncedData(results.syncedIds);

      // Update last sync timestamp
      final prefs = await SharedPreferences.getInstance();
      final now = DateTime.now().millisecondsSinceEpoch;
      await prefs.setInt(_lastSyncKey, now);

      state = state.copyWith(
        isSyncing: false,
        lastSyncTimestamp: now,
        pendingScans: state.pendingScans
            .where((s) => !results.syncedIds.contains(s.id))
            .toList(),
        pendingLogs: state.pendingLogs
            .where((l) => !results.syncedIds.contains(l.id))
            .toList(),
      );

      return results;
    } catch (e) {
      state = state.copyWith(isSyncing: false);
      return SyncResult.failure(e.toString());
    }
  }

  Future<SyncResult> _performSync() async {
    final apiService = _ref.read(apiServiceProvider);
    final syncedIds = <String>[];
    final failedItems = <Map<String, dynamic>>[];

    // Sync scans
    for (final scan in state.pendingScans) {
      try {
        final response = await apiService.post('/api/scans', {
          'qrCode': scan.qrCode,
          'scannedAt': scan.scannedAt.toIso8601String(),
          'gpsLatitude': scan.latitude,
          'gpsLongitude': scan.longitude,
          'gpsAccuracy': scan.accuracy,
          'cycleId': scan.cycleId,
          'batchId': scan.batchId,
        });

        if (response.success) {
          syncedIds.add(scan.id);
        } else {
          throw Exception(response.error);
        }
      } catch (e) {
        failedItems.add({
          'id': scan.id,
          'type': 'scan',
          'error': e.toString(),
        });
      }
    }

    // Sync cultivation logs
    for (final log in state.pendingLogs) {
      try {
        // Upload photos first if any
        List<String>? photoUrls;
        if (log.photoPaths != null && log.photoPaths!.isNotEmpty) {
          photoUrls = await _uploadPhotos(apiService, log.photoPaths!);
        }

        final response = await apiService.post('/api/cultivation-logs', {
          'cycleId': log.cycleId,
          'logType': log.logType,
          'logDate': log.logDate.toIso8601String(),
          'notes': log.notes,
          'quantity': log.quantity,
          'unit': log.unit,
          'photoUrls': photoUrls,
          'gpsLatitude': log.latitude,
          'gpsLongitude': log.longitude,
        });

        if (response.success) {
          syncedIds.add(log.id);
        } else {
          throw Exception(response.error);
        }
      } catch (e) {
        failedItems.add({
          'id': log.id,
          'type': 'log',
          'error': e.toString(),
        });
      }
    }

    // Store failed items for retry
    if (failedItems.isNotEmpty) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('sync_failures', jsonEncode(failedItems));
    }

    return SyncResult.success(
      syncedCount: syncedIds.length,
      failedCount: failedItems.length,
      syncedIds: syncedIds,
    );
  }

  Future<List<String>> _uploadPhotos(
      ApiService apiService, List<String> photoPaths) async {
    final urls = <String>[];

    for (final path in photoPaths) {
      try {
        // TODO: Implement multipart upload using dio
        // For now, skip photo upload
        urls.add('pending:$path');
      } catch (e) {
        // Log error but continue
      }
    }

    return urls;
  }

  Future<void> _clearSyncedData(List<String> syncedIds) async {
    final prefs = await SharedPreferences.getInstance();

    final remainingScans = state.pendingScans
        .where((s) => !syncedIds.contains(s.id))
        .map((s) => jsonEncode(s.toJson()))
        .toList();

    final remainingLogs = state.pendingLogs
        .where((l) => !syncedIds.contains(l.id))
        .map((l) => jsonEncode(l.toJson()))
        .toList();

    await prefs.setStringList(_scansKey, remainingScans);
    await prefs.setStringList(_logsKey, remainingLogs);
  }

  /// Clear all pending data (use with caution)
  Future<void> clearAll() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_scansKey);
    await prefs.remove(_logsKey);

    state = const OfflineStorageState();
  }
}

/// Pending Scan Model
class PendingScan {
  final String id;
  final String qrCode;
  final DateTime scannedAt;
  final double? latitude;
  final double? longitude;
  final double? accuracy;
  final String? cycleId;
  final String? batchId;

  PendingScan({
    String? id,
    required this.qrCode,
    required this.scannedAt,
    this.latitude,
    this.longitude,
    this.accuracy,
    this.cycleId,
    this.batchId,
  }) : id = id ?? DateTime.now().millisecondsSinceEpoch.toString();

  Map<String, dynamic> toJson() => {
        'id': id,
        'qrCode': qrCode,
        'scannedAt': scannedAt.toIso8601String(),
        'latitude': latitude,
        'longitude': longitude,
        'accuracy': accuracy,
        'cycleId': cycleId,
        'batchId': batchId,
      };

  factory PendingScan.fromJson(Map<String, dynamic> json) => PendingScan(
        id: json['id'],
        qrCode: json['qrCode'],
        scannedAt: DateTime.parse(json['scannedAt']),
        latitude: json['latitude']?.toDouble(),
        longitude: json['longitude']?.toDouble(),
        accuracy: json['accuracy']?.toDouble(),
        cycleId: json['cycleId'],
        batchId: json['batchId'],
      );
}

/// Pending Cultivation Log Model
class PendingCultivationLog {
  final String id;
  final String cycleId;
  final String logType;
  final DateTime logDate;
  final String? notes;
  final double? quantity;
  final String? unit;
  final List<String>? photoPaths;
  final double? latitude;
  final double? longitude;

  PendingCultivationLog({
    String? id,
    required this.cycleId,
    required this.logType,
    required this.logDate,
    this.notes,
    this.quantity,
    this.unit,
    this.photoPaths,
    this.latitude,
    this.longitude,
  }) : id = id ?? DateTime.now().millisecondsSinceEpoch.toString();

  Map<String, dynamic> toJson() => {
        'id': id,
        'cycleId': cycleId,
        'logType': logType,
        'logDate': logDate.toIso8601String(),
        'notes': notes,
        'quantity': quantity,
        'unit': unit,
        'photoPaths': photoPaths,
        'latitude': latitude,
        'longitude': longitude,
      };

  factory PendingCultivationLog.fromJson(Map<String, dynamic> json) =>
      PendingCultivationLog(
        id: json['id'],
        cycleId: json['cycleId'],
        logType: json['logType'],
        logDate: DateTime.parse(json['logDate']),
        notes: json['notes'],
        quantity: json['quantity']?.toDouble(),
        unit: json['unit'],
        photoPaths: json['photoPaths']?.cast<String>(),
        latitude: json['latitude']?.toDouble(),
        longitude: json['longitude']?.toDouble(),
      );
}

/// Sync Result
class SyncResult {
  final bool success;
  final int syncedCount;
  final int failedCount;
  final List<String> syncedIds;
  final String? error;

  const SyncResult._({
    required this.success,
    this.syncedCount = 0,
    this.failedCount = 0,
    this.syncedIds = const [],
    this.error,
  });

  factory SyncResult.success({
    required int syncedCount,
    required int failedCount,
    required List<String> syncedIds,
  }) =>
      SyncResult._(
        success: true,
        syncedCount: syncedCount,
        failedCount: failedCount,
        syncedIds: syncedIds,
      );

  factory SyncResult.failure(String error) => SyncResult._(
        success: false,
        error: error,
      );

  static const SyncResult nothingToSync = SyncResult._(
    success: true,
    syncedCount: 0,
  );
}
