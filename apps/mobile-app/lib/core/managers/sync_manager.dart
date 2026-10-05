import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';
import '../../data/services/offline_storage_service.dart';

/// Sync Manager for offline data synchronization
/// Automatically syncs when connection is restored
class SyncManager {
  static final SyncManager _instance = SyncManager._internal();
  factory SyncManager() => _instance;
  SyncManager._internal();

  StreamSubscription<ConnectivityResult>? _connectivitySubscription;
  bool _isSyncing = false;
  final _syncStatusController = StreamController<SyncStatus>.broadcast();

  Stream<SyncStatus> get syncStatusStream => _syncStatusController.stream;

  /// Initialize sync manager
  void initialize() {
    _connectivitySubscription =
        Connectivity().onConnectivityChanged.listen(_handleConnectivityChange);
  }

  /// Handle connectivity changes
  Future<void> _handleConnectivityChange(ConnectivityResult result) async {
    if (result != ConnectivityResult.none && !_isSyncing) {
      await syncPendingData();
    }
  }

  /// Sync all pending data to server
  Future<SyncResult> syncPendingData() async {
    if (_isSyncing) {
      return SyncResult(
        success: false,
        message: 'Sync already in progress',
      );
    }

    _isSyncing = true;
    _syncStatusController.add(SyncStatus.syncing);

    try {
      // Get pending items from sync queue
      final pendingItems = await OfflineStorageService.getPendingSyncItems();
      int syncedCount = 0;
      int failedCount = 0;

      for (final item in pendingItems) {
        try {
          final success = await _syncItem(item);
          if (success) {
            await OfflineStorageService.removeSyncItem(item['id'] as int);
            syncedCount++;
          } else {
            failedCount++;
          }
        } catch (e) {
          failedCount++;
          // Will retry on next sync
        }
      }

      // Sync unsynced audits
      final unsyncedAudits = await OfflineStorageService.getUnsyncedAudits();
      for (final audit in unsyncedAudits) {
        try {
          final success = await _syncAudit(audit);
          if (success) {
            await OfflineStorageService.markAuditSynced(audit['_id']);
            syncedCount++;
          }
        } catch (e) {
          failedCount++;
        }
      }

      // Sync unsynced photos
      final unsyncedPhotos = await OfflineStorageService.getUnsyncedPhotos();
      for (final photo in unsyncedPhotos) {
        try {
          await _syncPhoto(photo);
          syncedCount++;
        } catch (e) {
          failedCount++;
        }
      }

      _syncStatusController.add(SyncStatus.completed);

      return SyncResult(
        success: failedCount == 0,
        syncedCount: syncedCount,
        failedCount: failedCount,
        message: 'ซิงค์แล้ว $syncedCount รายการ ไม่สำเร็จ $failedCount รายการ',
      );
    } catch (e) {
      _syncStatusController.add(SyncStatus.error);
      return SyncResult(
        success: false,
        message: 'Sync error: $e',
      );
    } finally {
      _isSyncing = false;
    }
  }

  /// Sync individual item from queue
  Future<bool> _syncItem(Map<String, dynamic> item) async {
    final tableName = item['table_name'] as String;
    // final action = item['action'] as String;
    // final data = jsonDecode(item['data'] as String);

    // TODO: Implement API calls based on table and action
    switch (tableName) {
      case 'audits':
        // Call audit API
        return true;
      case 'photos':
        // Call photo upload API
        return true;
      case 'signatures':
        // Call signature API
        return true;
      default:
        return false;
    }
  }

  /// Sync audit to server
  Future<bool> _syncAudit(Map<String, dynamic> audit) async {
    // TODO: Implement API call
    // final response = await ApiService.post('/v2/field-audits', audit);
    // return response.success;
    return true;
  }

  /// Sync photo to server
  Future<bool> _syncPhoto(Map<String, dynamic> photo) async {
    // TODO: Implement multipart upload
    // final response = await ApiService.uploadPhoto(
    //   '/v2/field-audits/${photo['audit_id']}/photos',
    //   photo,
    // );
    // return response.success;
    return true;
  }

  /// Pre-download data for offline use
  Future<void> preDownloadForAudit(String auditId) async {
    _syncStatusController.add(SyncStatus.downloading);

    try {
      // TODO: Download audit details
      // final audit = await ApiService.get('/v2/field-audits/$auditId');
      // await OfflineStorageService.saveAudit(audit);

      // TODO: Download template if not exists
      // final template = await ApiService.get('/v2/field-audits/templates/GACP-FULL-2025');
      // await OfflineStorageService.saveTemplates([template]);

      _syncStatusController.add(SyncStatus.completed);
    } catch (e) {
      _syncStatusController.add(SyncStatus.error);
      rethrow;
    }
  }

  /// Check if device is online
  Future<bool> isOnline() async {
    final result = await Connectivity().checkConnectivity();
    return result != ConnectivityResult.none;
  }

  /// Dispose resources
  void dispose() {
    _connectivitySubscription?.cancel();
    _syncStatusController.close();
  }
}

/// Sync status enum
enum SyncStatus {
  idle,
  syncing,
  downloading,
  completed,
  error,
}

/// Sync result class
class SyncResult {
  final bool success;
  final int syncedCount;
  final int failedCount;
  final String message;

  SyncResult({
    required this.success,
    this.syncedCount = 0,
    this.failedCount = 0,
    this.message = '',
  });
}
