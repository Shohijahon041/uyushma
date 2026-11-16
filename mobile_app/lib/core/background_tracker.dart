import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'h02_protocol.dart';

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
      tcpSocket = await Socket.connect(serverHost, serverPort, timeout: const Duration(seconds: 4));
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

  // GPS paketini yuborish sikli (har 10 soniyada)
  void startTimerLoop() {
    pingTimer?.cancel();
    pingTimer = Timer.periodic(const Duration(seconds: 10), (timer) async {
      if (!isTracking) return;

      try {
        final position = await Geolocator.getCurrentPosition(
          desiredAccuracy: LocationAccuracy.high,
          timeLimit: const Duration(seconds: 5),
        );

        final double speedKmh = (position.speed * 3.6).clamp(0.0, 250.0);
        final double course = position.heading.clamp(0.0, 360.0);

        final String packet = H02Protocol.buildPacket(
          virtualGpsId: virtualGpsId,
          latitude: position.latitude,
          longitude: position.longitude,
          speedKmh: speedKmh,
          course: course,
          timestamp: position.timestamp,
          isValid: true,
        );

        final socket = await getSocket();
        if (socket != null) {
          socket.add(utf8.encode(packet));
          await socket.flush();
          packetCount++;
        }

        // Bildirishnomani yangilash
        if (service is AndroidServiceInstance) {
          localNotifications.show(
            notificationId,
            'Smena Faol (Uyushma GPS)',
            'Tezlik: ${speedKmh.toStringAsFixed(1)} km/soat | Yuborildi: $packetCount ta',
            const NotificationDetails(
              android: AndroidNotificationDetails(
                notificationChannelId,
                'Uyushma Jonli GPS Xizmati',
                icon: '@mipmap/ic_launcher',
                ongoing: true,
              ),
            ),
          );
        }

        // Ilova UI ga ma'lumot uzatish
        service.invoke('GPS_UPDATE', {
          'latitude': position.latitude,
          'longitude': position.longitude,
          'speed': speedKmh,
          'packets': packetCount,
          'connected': socket != null,
        });

      } catch (e) {
        debugPrint('[TRACKER-ERROR] $e');
      }
    });
  }

  // Hodisalarni tinglash
  service.on('START_TRACKING').listen((event) {
    if (event != null) {
      virtualGpsId = event['virtual_gps_id'] ?? virtualGpsId;
      serverHost = event['host'] ?? serverHost;
      serverPort = event['port'] ?? serverPort;
    }
    isTracking = true;
    packetCount = 0;
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

