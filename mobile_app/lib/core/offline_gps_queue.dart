import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

/// Oflayn GPS Navbati (Offline GPS Queue)
/// Haydovchi internet yo'q hududda (tog'li yo'llar, tunnel, aloqa yo'q hududlar)
/// harakatlanganda, koordinatalar yo'qolib ketmasligi uchun lokal SQLite bazasiga
/// vaqtinchalik saqlaydi va internet tiklangach serverga Bulk Sync qiladi.
class OfflineGpsQueue {
  static final OfflineGpsQueue _instance = OfflineGpsQueue._internal();
  factory OfflineGpsQueue() => _instance;
  OfflineGpsQueue._internal();

  static const String _tableName = 'offline_gps_queue';
  static const int _maxQueueSize = 10000; // Maksimal 10K nuqta (~28 soatlik harakat)
  Database? _db;

  Future<Database> get database async {
    if (_db != null && _db!.isOpen) return _db!;
    _db = await _initDatabase();
    return _db!;
  }

  Future<Database> _initDatabase() async {
    final dbPath = await getDatabasesPath();
    final path = p.join(dbPath, 'uyushma_gps_queue.db');

    return await openDatabase(
      path,
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE $_tableName (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            virtual_gps_id TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            speed_kmh REAL NOT NULL,
            course REAL NOT NULL,
            point_time TEXT NOT NULL,
            is_valid INTEGER NOT NULL,
            created_at INTEGER NOT NULL
          )
        ''');
        await db.execute('CREATE INDEX idx_offline_created ON $_tableName (created_at)');
      },
    );
  }

  /// Nuqtani oflayn navbatga saqlash
  Future<int> enqueue({
    required String virtualGpsId,
    required double latitude,
    required double longitude,
    required double speedKmh,
    required double course,
    required DateTime timestamp,
    bool isValid = true,
  }) async {
    try {
      final db = await database;

      // Agar navbat 10K dan oshsa, eng eski 500 ta nuqtani tozalash (xotira to'lib ketmasligi uchun)
      final count = Sqflite.firstIntValue(
        await db.rawQuery('SELECT COUNT(*) FROM $_tableName'),
      ) ?? 0;

      if (count >= _maxQueueSize) {
        await db.rawDelete('''
          DELETE FROM $_tableName WHERE id IN (
            SELECT id FROM $_tableName ORDER BY id ASC LIMIT 500
          )
        ''');
      }

      return await db.insert(
        _tableName,
        {
          'virtual_gps_id': virtualGpsId,
          'latitude': latitude,
          'longitude': longitude,
          'speed_kmh': speedKmh,
          'course': course,
          'point_time': timestamp.toUtc().toIso8601String(),
          'is_valid': isValid ? 1 : 0,
          'created_at': DateTime.now().millisecondsSinceEpoch,
        },
      );
    } catch (e) {
      debugPrint('[OFFLINE-GPS-ENQUEUE-ERROR] $e');
      return -1;
    }
  }

  /// Navbatdan serverga yuborish uchun to'plam (Batch) olish
  Future<List<Map<String, dynamic>>> getBatch({int limit = 50}) async {
    try {
      final db = await database;
      return await db.query(
        _tableName,
        orderBy: 'id ASC',
        limit: limit,
      );
    } catch (e) {
      debugPrint('[OFFLINE-GPS-BATCH-ERROR] $e');
      return [];
    }
  }

  /// Muvaffaqiyatli serverga yuborilgan nuqtalarni o'chirish
  Future<int> deleteBatch(List<int> ids) async {
    if (ids.isEmpty) return 0;
    try {
      final db = await database;
      final placeholders = List.filled(ids.length, '?').join(',');
      return await db.delete(
        _tableName,
        where: 'id IN ($placeholders)',
        whereArgs: ids,
      );
    } catch (e) {
      debugPrint('[OFFLINE-GPS-DELETE-ERROR] $e');
      return 0;
    }
  }

  /// Hozirda navbatda turgan nuqtalar soni
  Future<int> getQueueCount() async {
    try {
      final db = await database;
      return Sqflite.firstIntValue(
        await db.rawQuery('SELECT COUNT(*) FROM $_tableName'),
      ) ?? 0;
    } catch (e) {
      return 0;
    }
  }

  /// Barcha saqlangan nuqtalarni tozalash
  Future<void> clearAll() async {
    try {
      final db = await database;
      await db.delete(_tableName);
    } catch (e) {
      debugPrint('[OFFLINE-GPS-CLEAR-ERROR] $e');
    }
  }
}

