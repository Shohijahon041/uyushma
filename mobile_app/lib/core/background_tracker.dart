import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:http/http.dart' as http;
import 'h02_protocol.dart';
import 'offline_gps_queue.dart';

const String notificationChannelId = 'uyushma_gps_channel';
const int notificationId = 888;

/// Fon xizmatini boshqaruvchi asosiy sinf
class BackgroundTrackerManager {
  static final BackgroundTrackerManager _instance = BackgroundTrackerManager._internal();
  factory BackgroundTrackerManager() => _instance;
  BackgroundTrackerManager._internal();

  /// Fon xizmatini tizimda ro'yxatdan o'tkazish
  static Future<void> initializeService() async {
    final service = FlutterBackgroundService();

    // Android bildirishnoma kanali
    const AndroidNotificationChannel channel = AndroidNotificationChannel(
      notificationChannelId,
      'Uyushma Jonli GPS Xizmati',
      description: 'H02 protokoli orqali uzluksiz telemetriya uzatish xizmati',
      importance: Importance.low,
    );

    final FlutterLocalNotificationsPlugin flutterLocalNotificationsPlugin =
        FlutterLocalNotificationsPlugin();

    if (Platform.isAndroid) {
      const AndroidInitializationSettings initializationSettingsAndroid =
          AndroidInitializationSettings('@mipmap/ic_launcher');
      await flutterLocalNotificationsPlugin.initialize(
        const InitializationSettings(android: initializationSettingsAndroid),
      );

      await flutterLocalNotificationsPlugin
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(channel);
    }

    await service.configure(
      androidConfiguration: AndroidConfiguration(
        onStart: onServiceStart,
        autoStart: false,
        isForegroundMode: true,
        notificationChannelId: notificationChannelId,
        initialNotificationTitle: 'Uyushma GPS Treker',
        initialNotificationContent: 'Smena kutilmoqda...',
        foregroundServiceNotificationId: notificationId,
      ),
      iosConfiguration: IosConfiguration(
        autoStart: false,
        onForeground: onServiceStart,
        onBackground: onIosBackground,
      ),
    );
  }

  /// Smenani boshlash (Fon rejimida H02 TCP oqimini yoqish)
  static Future<void> startShift({
    required String virtualGpsId,
    String host = '189.74.100.25', // Gateway Server IP
    int port = 20335,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('pref_virtual_gps_id', virtualGpsId);
    await prefs.setString('pref_server_host', host);
    await prefs.setInt('pref_server_port', port);
    await prefs.setBool('pref_is_shift_active', true);

    final service = FlutterBackgroundService();
    if (!await service.isRunning()) {
      await service.startService();
    }
    service.invoke('START_TRACKING', {
      'virtual_gps_id': virtualGpsId,
      'host': host,
      'port': port,
    });
  }

  /// Smenani yakunlash (Trekingni to'xtatish)
  static Future<void> stopShift() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('pref_is_shift_active', false);

    final service = FlutterBackgroundService();
    service.invoke('STOP_TRACKING');
  }
}

// iOS Fon handleri
@pragma('vm:entry-point')
Future<bool> onIosBackground(ServiceInstance service) async {
  WidgetsFlutterBinding.ensureInitialized();
  DartPluginRegistrant.ensureInitialized();
  return true;
}

// Android & iOS Service Start Handleri
@pragma('vm:entry-point')
void onServiceStart(ServiceInstance service) async {
  DartPluginRegistrant.ensureInitialized();

  final FlutterLocalNotificationsPlugin localNotifications =
      FlutterLocalNotificationsPlugin();

  Socket? tcpSocket;
  Timer? pingTimer;
  bool isTracking = false;
  String virtualGpsId = '9012345678';
  String serverHost = '189.74.100.25';
  int serverPort = 20335;
  int packetCount = 0;

  // TCP ulanishni barqaror ushlab turish funksiyasi
  Future<Socket?> getSocket() async {
    if (tcpSocket != null) return tcpSocket;
    try {
      tcpSocket = await Socket.connect(serverHost, serverPort, timeout: const Duration(seconds: 3));
      tcpSocket!.listen(
        (data) {
          final res = utf8.decode(data, allowMalformed: true);
          debugPrint('[H02-SERVER-RESPONSE] $res');
        },
        onError: (e) {
          tcpSocket?.destroy();
          tcpSocket = null;
        },
        onDone: () {
          tcpSocket?.destroy();
          tcpSocket = null;
        },
        cancelOnError: true,
      );
      return tcpSocket;
    } catch (e) {
      tcpSocket = null;
      return null;
    }
  }

  // Oflayn navbatdagi koordinatalarni serverga ommaviy sinxronlash (Bulk Sync)
  bool isSyncingOffline = false;
  Future<void> drainOfflineQueue() async {
    if (isSyncingOffline) return;
    isSyncingOffline = true;
    try {
      final queue = OfflineGpsQueue();
      int pending = await queue.getQueueCount();
      if (pending == 0) {
        isSyncingOffline = false;
        return;
      }

      while (pending > 0 && isTracking) {
        final batch = await queue.getBatch(limit: 50);
        if (batch.isEmpty) break;

        final List<Map<String, dynamic>> pointsPayload = batch.map((row) {
          return {
            'virtual_gps_id': row['virtual_gps_id'],
            'latitude': row['latitude'],
            'longitude': row['longitude'],
            'speed_kmh': row['speed_kmh'],
            'course': row['course'],
            'time': row['point_time'],
            'is_valid': row['is_valid'] == 1,
          };
        }).toList();

        try {
          final res = await http.post(
            Uri.parse('https://uyushma.bmbrutto.uz/api/v1/gps/bulk'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'points': pointsPayload}),
          ).timeout(const Duration(seconds: 5));

          if (res.statusCode == 200) {
            final List<int> ids = batch.map((r) => r['id'] as int).toList();
            await queue.deleteBatch(ids);
            pending = await queue.getQueueCount();
            debugPrint('[BULK-SYNC-SUCCESS] ${ids.length} ta oflayn nuqta uzatildi. Qoldi: $pending');
          } else {
            break;
          }
        } catch (syncErr) {
          debugPrint('[BULK-SYNC-FAIL] $syncErr');
          break;
        }
      }
    } catch (e) {
      debugPrint('[BULK-SYNC-ERROR] $e');
    } finally {
      isSyncingOffline = false;
    }
  }

  // Telemetriya paketini yuborish (TCP 20335 + HTTPS fallback + Offline Queue)
  Future<void> sendTelemetryPacket() async {
    if (!isTracking) return;

    try {
      Position? position;
      try {
        position = await Geolocator.getLastKnownPosition();
      } catch (_) {}

      if (position == null) {
        try {
          position = await Geolocator.getCurrentPosition(
            desiredAccuracy: LocationAccuracy.medium,
            timeLimit: const Duration(seconds: 4),
          );
        } catch (e) {
          debugPrint('[GPS-FALLBACK] $e');
        }
      }

      final double lat = position?.latitude ?? 41.2995;
      final double lon = position?.longitude ?? 69.2401;
      final double speedKmh = position != null ? (position.speed * 3.6).clamp(0.0, 250.0) : 0.0;
      final double course = position != null ? position.heading.clamp(0.0, 360.0) : 0.0;
      final DateTime timestamp = position?.timestamp ?? DateTime.now();

      final String packet = H02Protocol.buildPacket(
        virtualGpsId: virtualGpsId,
        latitude: lat,
        longitude: lon,
        speedKmh: speedKmh,
        course: course,
        timestamp: timestamp,
        isValid: true,
      );

      bool isConnected = false;

      // 1. Asosiy H02 TCP soketi (port 20335)
      try {
        final socket = await getSocket();
        if (socket != null) {
          socket.add(utf8.encode(packet));
          await socket.flush();
          packetCount++;
          isConnected = true;
        }
      } catch (err) {
        tcpSocket?.destroy();
        tcpSocket = null;
      }

      // 2. Agar TCP ulanmagan bo'lsa, zaxira HTTPS API orqali yuborish (port 443)
      if (!isConnected) {
        try {
          final res = await http.post(
            Uri.parse('https://uyushma.bmbrutto.uz/api/v1/gps/ping'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'virtual_gps_id': virtualGpsId,
              'latitude': lat,
              'longitude': lon,
              'speed_kmh': speedKmh,
              'course': course,
              'is_valid': true,
            }),
          ).timeout(const Duration(seconds: 3));

          if (res.statusCode == 200) {
            packetCount++;
            isConnected = true;
          }
        } catch (httpErr) {
          debugPrint('[HTTPS-PING-ERR] $httpErr');
        }
      }

      // 3. OFLAYN REJIM: Agar internet yo'q bo'lsa (TCP va HTTPS ikkalasi ham ishlamasa),
      // koordinatani lokal SQLite bazasiga saqlab qo'yamiz!
      if (!isConnected) {
        await OfflineGpsQueue().enqueue(
          virtualGpsId: virtualGpsId,
          latitude: lat,
          longitude: lon,
          speedKmh: speedKmh,
          course: course,
          timestamp: timestamp,
          isValid: true,
        );
      } else {
        // Aloqa mavjud bo'lganda oflayn navbatni serverga uzatish (Bulk Sync)
        drainOfflineQueue();
      }

      final int cachedCount = await OfflineGpsQueue().getQueueCount();

      // Minimalistik va real vaqtda tezlikni ko'rsatuvchi bezovta qilmaydigan bildirishnoma
      if (service is AndroidServiceInstance) {
        final String notifTitle = isConnected ? 'Uyushma GPS • Faol' : 'Uyushma GPS • Oflayn rejim';
        final String notifContent = isConnected
            ? 'Tezlik: ${speedKmh.toStringAsFixed(0)} km/soat • Aloqa: Barqaror'
            : 'Tezlik: ${speedKmh.toStringAsFixed(0)} km/soat • Keshda: $cachedCount ta nuqta';

        localNotifications.show(
          notificationId,
          notifTitle,
          notifContent,
          const NotificationDetails(
            android: AndroidNotificationDetails(
              notificationChannelId,
              'Uyushma Jonli GPS Xizmati',
              icon: '@mipmap/ic_launcher',
              ongoing: true,
              showWhen: false,
              playSound: false,
              enableVibration: false,
              importance: Importance.low,
              priority: Priority.low,
            ),
          ),
        );
      }

      // Ilova UI ga ma'lumot uzatish
      service.invoke('GPS_UPDATE', {
        'latitude': lat,
        'longitude': lon,
        'speed': speedKmh,
        'packets': packetCount,
        'connected': isConnected,
        'offline_cached': cachedCount,
      });

    } catch (e) {
      debugPrint('[TRACKER-ERROR] $e');
    }
  }


  // GPS paketini yuborish sikli (darhol boshlash va har 8 soniyada)
  void startTimerLoop() {
    pingTimer?.cancel();
    // Darhol birinchi paketni yuborish (10 soniya kutmasdan)
    sendTelemetryPacket();
    pingTimer = Timer.periodic(const Duration(seconds: 8), (timer) {
      sendTelemetryPacket();
    });
  }

  // Avtomatik tiklash: Agar avval smena faol bo'lsa
  SharedPreferences.getInstance().then((prefs) {
    if (prefs.getBool('pref_is_shift_active') == true) {
      virtualGpsId = prefs.getString('pref_virtual_gps_id') ?? virtualGpsId;
      serverHost = prefs.getString('pref_server_host') ?? serverHost;
      serverPort = prefs.getInt('pref_server_port') ?? serverPort;
      isTracking = true;
      startTimerLoop();
    }
  });

  // Hodisalarni tinglash
  service.on('START_TRACKING').listen((event) {
    if (event != null) {
      virtualGpsId = event['virtual_gps_id'] ?? virtualGpsId;
      serverHost = event['host'] ?? serverHost;
      serverPort = event['port'] ?? serverPort;
    }
    isTracking = true;
    startTimerLoop();
  });

  service.on('STOP_TRACKING').listen((event) {
    isTracking = false;
    pingTimer?.cancel();
    tcpSocket?.destroy();
    tcpSocket = null;
    service.stopSelf();
  });
}

