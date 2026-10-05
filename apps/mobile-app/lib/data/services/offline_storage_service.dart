import 'dart:convert';
import 'package:sqflite/sqflite.dart';
import 'package:path/path.dart';

/// Offline Storage Service for Field Audit
/// Uses SQLite for local data persistence
class OfflineStorageService {
  static Database? _database;
  static const String _dbName = 'gacp_offline.db';
  static const int _dbVersion = 1;

  /// Initialize database
  static Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDatabase();
    return _database!;
  }

  static Future<Database> _initDatabase() async {
    final dbPath = await getDatabasesPath();
    final path = join(dbPath, _dbName);

    return await openDatabase(
      path,
      version: _dbVersion,
      onCreate: _onCreate,
      onUpgrade: _onUpgrade,
    );
  }

  static Future<void> _onCreate(Database db, int version) async {
    // Audit Templates table
    await db.execute('''
      CREATE TABLE audit_templates (
        id TEXT PRIMARY KEY,
        template_code TEXT,
        name TEXT,
        name_th TEXT,
        categories TEXT,
        created_at TEXT,
        synced_at TEXT
      )
    ''');

    // Audits table
    await db.execute('''
      CREATE TABLE audits (
        id TEXT PRIMARY KEY,
        audit_number TEXT,
        application_id TEXT,
        Applicant_name TEXT,
        farm_name TEXT,
        scheduled_date TEXT,
        audit_mode TEXT,
        status TEXT,
        responses TEXT,
        synced INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT
      )
    ''');

    // Photos table
    await db.execute('''
      CREATE TABLE photos (
        id TEXT PRIMARY KEY,
        audit_id TEXT,
        item_code TEXT,
        file_path TEXT,
        lat REAL,
        lng REAL,
        accuracy REAL,
        captured_at TEXT,
        synced INTEGER DEFAULT 0,
        FOREIGN KEY (audit_id) REFERENCES audits(id)
      )
    ''');

    // Signatures table
    await db.execute('''
      CREATE TABLE signatures (
        id TEXT PRIMARY KEY,
        audit_id TEXT,
        signer_role TEXT,
        signature_data TEXT,
        signed_at TEXT,
        synced INTEGER DEFAULT 0,
        FOREIGN KEY (audit_id) REFERENCES audits(id)
      )
    ''');

    // Sync queue table
    await db.execute('''
      CREATE TABLE sync_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        table_name TEXT,
        record_id TEXT,
        action TEXT,
        data TEXT,
        created_at TEXT,
        retry_count INTEGER DEFAULT 0
      )
    ''');
  }

  static Future<void> _onUpgrade(
      Database db, int oldVersion, int newVersion) async {
    // Handle database migrations
    if (oldVersion < 2) {
      // Future migrations
    }
  }

  // ===========================================
  // Audit Template Methods
  // ===========================================

  /// Save audit templates for offline use
  static Future<void> saveTemplates(
      List<Map<String, dynamic>> templates) async {
    final db = await database;
    final batch = db.batch();

    for (final template in templates) {
      batch.insert(
        'audit_templates',
        {
          'id': template['_id'],
          'template_code': template['templateCode'],
          'name': template['name'],
          'name_th': template['nameTh'],
          'categories': jsonEncode(template['categories']),
          'created_at': template['createdAt'],
          'synced_at': DateTime.now().toIso8601String(),
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    }

    await batch.commit(noResult: true);
  }

  /// Get template by code
  static Future<Map<String, dynamic>?> getTemplate(String templateCode) async {
    final db = await database;
    final results = await db.query(
      'audit_templates',
      where: 'template_code = ?',
      whereArgs: [templateCode],
    );

    if (results.isEmpty) return null;

    final row = results.first;
    return {
      '_id': row['id'],
      'templateCode': row['template_code'],
      'name': row['name'],
      'nameTh': row['name_th'],
      'categories': jsonDecode(row['categories'] as String),
      'createdAt': row['created_at'],
    };
  }

  // ===========================================
  // Audit Methods
  // ===========================================

  /// Save audit locally
  static Future<void> saveAudit(Map<String, dynamic> audit) async {
    final db = await database;

    await db.insert(
      'audits',
      {
        'id': audit['_id'],
        'audit_number': audit['auditNumber'],
        'application_id': audit['applicationId'],
        'Applicant_name': audit['ApplicantName'],
        'farm_name': audit['farmName'],
        'scheduled_date': audit['scheduledDate'],
        'audit_mode': audit['auditMode'],
        'status': audit['status'],
        'responses': jsonEncode(audit['responses'] ?? []),
        'synced': 0,
        'created_at': DateTime.now().toIso8601String(),
        'updated_at': DateTime.now().toIso8601String(),
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );

    // Add to sync queue
    await _addToSyncQueue('audits', audit['_id'], 'upsert', audit);
  }

  /// Get unsynced audits
  static Future<List<Map<String, dynamic>>> getUnsyncedAudits() async {
    final db = await database;
    final results = await db.query(
      'audits',
      where: 'synced = ?',
      whereArgs: [0],
    );

    return results
        .map((row) => {
              '_id': row['id'],
              'auditNumber': row['audit_number'],
              'applicationId': row['application_id'],
              'ApplicantName': row['Applicant_name'],
              'farmName': row['farm_name'],
              'scheduledDate': row['scheduled_date'],
              'auditMode': row['audit_mode'],
              'status': row['status'],
              'responses': jsonDecode(row['responses'] as String? ?? '[]'),
            })
        .toList();
  }

  /// Mark audit as synced
  static Future<void> markAuditSynced(String auditId) async {
    final db = await database;
    await db.update(
      'audits',
      {'synced': 1, 'updated_at': DateTime.now().toIso8601String()},
      where: 'id = ?',
      whereArgs: [auditId],
    );
  }

  // ===========================================
  // Photo Methods
  // ===========================================

  /// Save photo locally
  static Future<void> savePhoto(Map<String, dynamic> photo) async {
    final db = await database;

    await db.insert(
      'photos',
      {
        'id': photo['id'] ?? DateTime.now().millisecondsSinceEpoch.toString(),
        'audit_id': photo['auditId'],
        'item_code': photo['itemCode'],
        'file_path': photo['filePath'],
        'lat': photo['lat'],
        'lng': photo['lng'],
        'accuracy': photo['accuracy'],
        'captured_at': photo['capturedAt'] ?? DateTime.now().toIso8601String(),
        'synced': 0,
      },
      conflictAlgorithm: ConflictAlgorithm.replace,
    );

    await _addToSyncQueue('photos', photo['id'], 'create', photo);
  }

  /// Get unsynced photos
  static Future<List<Map<String, dynamic>>> getUnsyncedPhotos() async {
    final db = await database;
    return await db.query('photos', where: 'synced = ?', whereArgs: [0]);
  }

  // ===========================================
  // Sync Queue Methods
  // ===========================================

  static Future<void> _addToSyncQueue(
    String tableName,
    String recordId,
    String action,
    Map<String, dynamic> data,
  ) async {
    final db = await database;
    await db.insert('sync_queue', {
      'table_name': tableName,
      'record_id': recordId,
      'action': action,
      'data': jsonEncode(data),
      'created_at': DateTime.now().toIso8601String(),
    });
  }

  /// Get pending sync items
  static Future<List<Map<String, dynamic>>> getPendingSyncItems() async {
    final db = await database;
    return await db.query(
      'sync_queue',
      orderBy: 'created_at ASC',
      limit: 50,
    );
  }

  /// Remove from sync queue
  static Future<void> removeSyncItem(int id) async {
    final db = await database;
    await db.delete('sync_queue', where: 'id = ?', whereArgs: [id]);
  }

  /// Clear all offline data
  static Future<void> clearAll() async {
    final db = await database;
    await db.delete('sync_queue');
    await db.delete('photos');
    await db.delete('signatures');
    await db.delete('audits');
    await db.delete('audit_templates');
  }
}
