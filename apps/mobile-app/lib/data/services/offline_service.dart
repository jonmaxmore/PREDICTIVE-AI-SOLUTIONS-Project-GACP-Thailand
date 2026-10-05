import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final offlineServiceProvider = Provider<OfflineService>((ref) {
  return OfflineService();
});

class OfflineService {
  static const String _inspectionBoxName = 'offline_inspections';
  
  Future<void> init() async {
    await Hive.initFlutter();
    await Hive.openBox(_inspectionBoxName);
  }

  Future<bool> isConnected() async {
    final connectivityResult = await Connectivity().checkConnectivity();
    return connectivityResult != ConnectivityResult.none;
  }

  Future<void> saveInspectionLocally(String applicationId, Map<String, dynamic> data) async {
    final box = Hive.box(_inspectionBoxName);
    await box.put(applicationId, {
      ...data,
      'timestamp': DateTime.now().toIso8601String(),
      'synced': false,
    });
  }

  Future<List<Map<String, dynamic>>> getPendingInspections() async {
    final box = Hive.box(_inspectionBoxName);
    final List<Map<String, dynamic>> pending = [];
    
    for (var i = 0; i < box.length; i++) {
      final item = box.getAt(i) as Map;
      if (item['synced'] == false) {
        pending.add(Map<String, dynamic>.from(item));
      }
    }
    
    return pending;
  }

  Future<void> markAsSynced(String applicationId) async {
    final box = Hive.box(_inspectionBoxName);
    await box.delete(applicationId);
  }
}
