import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/api_service.dart';
import '../core/background_tracker.dart';
import '../core/battery_optimizer.dart';
import '../core/h02_protocol.dart';
import 'login_screen.dart';
import 'unified_profile.dart';
import 'waybill_modal.dart';

class HomeDashboardScreen extends StatefulWidget {
  const HomeDashboardScreen({super.key});

  @override
  State<HomeDashboardScreen> createState() => _HomeDashboardScreenState();
}

class _HomeDashboardScreenState extends State<HomeDashboardScreen> {
  // Smena holati va hisoblagichlar
  bool _isShiftActive = false;
  bool _isLoading = true;
  Map<String, dynamic>? _profileData;
  DateTime? _shiftStartedAt;
  Timer? _shiftTimer;
  String _shiftDurationStr = '00:00:00';
  int? _startOdometer;
  double _shiftDistanceKm = 0.0;
  Position? _lastPosition;

  // Jonli GPS ko'rsatkichlari
  double _currentSpeed = 0.0;
  double _latitude = 41.2995;
  double _longitude = 69.2401;
  double _gpsAccuracyMeters = 3.5;
  int _packetsSent = 0;
  bool _isServerConnected = false;
  int _offlineCachedCount = 0;
  String _connectionType = 'OFFLINE'; // 'TCP_20335', 'HTTPS_PING', 'OFFLINE'

  // To'g'ridan-to'g'ri faol telemetriya
  Timer? _liveTelemetryTimer;
  Socket? _liveSocket;
  StreamSubscription<Position>? _positionStreamSub;

  @override
  void initState() {
    super.initState();
    _checkInitialShiftState();
    _loadProfile();
    _listenBackgroundService();

    // Batareya optimizatsiyasidan chiqarish so'rovi (fondagi xizmat o'chib qolmasligi uchun)
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        BatteryOptimizer.requestOptimizationDisable(context);
      }
    });
  }

  @override
  void dispose() {
    _stopLiveTelemetry();
    _shiftTimer?.cancel();
    super.dispose();
  }

  void _startShiftTimer(DateTime startTime) {
    _shiftTimer?.cancel();
    _shiftStartedAt = startTime;
    _updateDurationString();
    _shiftTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && _isShiftActive) {
        _updateDurationString();
      }
    });
  }

  void _updateDurationString() {
    if (_shiftStartedAt == null) return;
    final diff = DateTime.now().difference(_shiftStartedAt!);
    final hours = diff.inHours.toString().padLeft(2, '0');
    final mins = (diff.inMinutes % 60).toString().padLeft(2, '0');
    final secs = (diff.inSeconds % 60).toString().padLeft(2, '0');
    setState(() {
      _shiftDurationStr = '$hours:$mins:$secs';
    });
  }

  Future<void> _checkInitialShiftState() async {
    final prefs = await SharedPreferences.getInstance();
    final isActive = prefs.getBool('pref_is_shift_active') ?? false;
    final virtualGpsId = prefs.getString('pref_virtual_gps_id') ?? '9170121311';
    final startTimeStr = prefs.getString('pref_shift_start_time');
    final startOdo = prefs.getInt('pref_start_odometer');

    if (mounted) {
      setState(() {
        _isShiftActive = isActive;
        if (startOdo != null) _startOdometer = startOdo;
      });
    }

    if (isActive) {
      if (startTimeStr != null) {
        final startDt = DateTime.tryParse(startTimeStr);
        if (startDt != null) _startShiftTimer(startDt);
      } else {
        _startShiftTimer(DateTime.now());
      }
      _startLiveTelemetry(virtualGpsId);
    }
  }

  void _listenBackgroundService() {
    FlutterBackgroundService().on('GPS_UPDATE').listen((event) {
      if (event != null && mounted) {
        final double? speed = (event['speed'] as num?)?.toDouble();
        final double? lat = (event['latitude'] as num?)?.toDouble();
        final double? lon = (event['longitude'] as num?)?.toDouble();
        final double? accuracy = (event['accuracy'] as num?)?.toDouble();

        if (_isShiftActive && lat != null && lon != null) {
          if (_lastPosition != null) {
            final d = Geolocator.distanceBetween(
              _lastPosition!.latitude,
              _lastPosition!.longitude,
              lat,
              lon,
            );
            if (d > 3 && d < 2000) {
              _shiftDistanceKm += d / 1000.0;
            }
          }
          _lastPosition = Position(
            latitude: lat,
            longitude: lon,
            timestamp: DateTime.now(),
            accuracy: accuracy ?? 5.0,
            altitude: 0.0,
            altitudeAccuracy: 0.0,
            heading: (event['course'] as num?)?.toDouble() ?? 0.0,
            headingAccuracy: 0.0,
            speed: (speed ?? 0.0) / 3.6,
            speedAccuracy: 0.0,
          );
        }

        setState(() {
          _latitude = lat ?? _latitude;
          _longitude = lon ?? _longitude;
          _currentSpeed = speed ?? _currentSpeed;
          _packetsSent = event['packets'] ?? _packetsSent;
          _isServerConnected = event['connected'] ?? _isServerConnected;
          _offlineCachedCount = event['offline_cached'] ?? _offlineCachedCount;
          if (accuracy != null) _gpsAccuracyMeters = accuracy;
        });
      }
    });
  }

  Future<void> _startLiveTelemetry(String virtualGpsId) async {
    _stopLiveTelemetry();

    // 1. Darhol birinchi ulanish va paketni uzatish
    await _sendTelemetryOnce(virtualGpsId);

    // 2. Har 5 soniyada muntazam yuborib turish
    _liveTelemetryTimer = Timer.periodic(const Duration(seconds: 5), (_) async {
      if (!_isShiftActive || !mounted) return;
      await _sendTelemetryOnce(virtualGpsId);
    });

    // 3. Geolocator stream orqali harakat va tezlikni real vaqtda kuzatish
    try {
      const locationSettings = LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 3,
      );
      _positionStreamSub = Geolocator.getPositionStream(locationSettings: locationSettings).listen((pos) {
        if (!mounted || !_isShiftActive) return;
        final speedKmh = (pos.speed * 3.6).clamp(0.0, 250.0);

        if (_lastPosition != null) {
          final d = Geolocator.distanceBetween(
            _lastPosition!.latitude,
            _lastPosition!.longitude,
            pos.latitude,
            pos.longitude,
          );
          if (d > 3 && d < 2000) {
            _shiftDistanceKm += d / 1000.0;
          }
        }
        _lastPosition = pos;

        setState(() {
          _latitude = pos.latitude;
          _longitude = pos.longitude;
          _currentSpeed = speedKmh;
          _gpsAccuracyMeters = pos.accuracy;
        });
      }, onError: (err) {
        debugPrint('[GEO-STREAM-ERR] $err');
      });
    } catch (e) {
      debugPrint('[GEO-STREAM-INIT-ERR] $e');
    }
  }

  void _stopLiveTelemetry() {
    _liveTelemetryTimer?.cancel();
    _liveTelemetryTimer = null;
    _positionStreamSub?.cancel();
    _positionStreamSub = null;
    _liveSocket?.destroy();
    _liveSocket = null;
  }

  Future<void> _sendTelemetryOnce(String virtualGpsId) async {
    try {
      Position? pos;
      try {
        pos = await Geolocator.getLastKnownPosition();
      } catch (_) {}

      if (pos == null) {
        try {
          pos = await Geolocator.getCurrentPosition(
            desiredAccuracy: LocationAccuracy.medium,
            timeLimit: const Duration(seconds: 3),
          );
        } catch (_) {}
      }

      final double lat = pos?.latitude ?? _latitude;
      final double lon = pos?.longitude ?? _longitude;
      final double speed = pos != null ? (pos.speed * 3.6).clamp(0.0, 250.0) : _currentSpeed;
      final double course = pos?.heading ?? 0.0;
      final DateTime time = pos?.timestamp ?? DateTime.now();

      final String packet = H02Protocol.buildPacket(
        virtualGpsId: virtualGpsId,
        latitude: lat,
        longitude: lon,
        speedKmh: speed,
        course: course,
        timestamp: time,
        isValid: true,
      );

      bool connected = false;
      String connType = 'OFFLINE';

      // 1-bosqich: To'g'ridan-to'g'ri SinoTrack H02 TCP soketi (port 20335)
      try {
        if (_liveSocket == null) {
          _liveSocket = await Socket.connect('189.74.100.25', 20335, timeout: const Duration(seconds: 3));
          _liveSocket!.listen(
            (data) {
              debugPrint('[H02-LIVE-RESP] ${utf8.decode(data, allowMalformed: true)}');
            },
            onError: (err) {
              _liveSocket?.destroy();
              _liveSocket = null;
            },
            onDone: () {
              _liveSocket?.destroy();
              _liveSocket = null;
            },
            cancelOnError: true,
          );
        }

        if (_liveSocket != null) {
          _liveSocket!.add(utf8.encode(packet));
          await _liveSocket!.flush();
          connected = true;
          connType = 'TCP_20335';
        }
      } catch (tcpErr) {
        _liveSocket?.destroy();
        _liveSocket = null;
      }

      // 2-bosqich: Zaxira HTTPS API (port 443)
      if (!connected) {
        try {
          final res = await http.post(
            Uri.parse('https://uyushma.bmbrutto.uz/api/v1/gps/ping'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'virtual_gps_id': virtualGpsId,
              'latitude': lat,
              'longitude': lon,
              'speed_kmh': speed,
              'course': course,
              'is_valid': true,
            }),
          ).timeout(const Duration(seconds: 3));

          if (res.statusCode == 200) {
            connected = true;
            connType = 'HTTPS_PING';
          }
        } catch (_) {}
      }

      if (mounted) {
        setState(() {
          _latitude = lat;
          _longitude = lon;
          _currentSpeed = speed;
          _connectionType = connType;
          if (connected) {
            _packetsSent++;
            _isServerConnected = true;
          } else {
            _isServerConnected = false;
          }
        });
      }
    } catch (e) {
      debugPrint('[LIVE-TELEMETRY-ERR] $e');
    }
  }

  Future<void> _loadProfile() async {
    try {
      final data = await ApiService().getUnifiedProfile();
      if (mounted) {
        setState(() {
          _profileData = data;
          _isLoading = false;
        });

        // Serverda faol smena bor-yo'qligini tekshirish
        final activeShift = data['active_shift'];
        if (activeShift != null && activeShift['is_active'] == true && !_isShiftActive) {
          final serverStartedAt = DateTime.tryParse(activeShift['started_at'] ?? '');
          final odo = (activeShift['start_odometer'] ?? activeShift['last_odometer'] ?? 145200) as int;
          _restoreShiftFromServer(serverStartedAt ?? DateTime.now(), odo);
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _restoreShiftFromServer(DateTime startedAt, int startOdo) async {
    final virtualGpsId = _profileData?['vehicle']?['virtual_gps_id'] ?? '9170121311';
    setState(() {
      _isShiftActive = true;
      _startOdometer = startOdo;
    });
    _startShiftTimer(startedAt);
    _startLiveTelemetry(virtualGpsId);
    await BackgroundTrackerManager.startShift(virtualGpsId: virtualGpsId);
  }

  Future<void> _toggleShift(bool value) async {
    if (value) {
      // 1. Ruxsatlarni tekshirish
      var locStatus = await Permission.locationWhenInUse.status;
      if (!locStatus.isGranted) {
        locStatus = await Permission.locationWhenInUse.request();
      }
      if (!locStatus.isGranted) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text("Joylashuv (GPS) ruxsati berilmadi!"),
              backgroundColor: Colors.red,
            ),
          );
        }
        return;
      }

      try {
        await Permission.locationAlways.request();
      } catch (_) {}

      // 2. Bloklanganlik tekshiruvi
      final isBlocked = _profileData?['driver']?['is_blocked'] ?? false;
      if (isBlocked) {
        if (mounted) {
          _showBlockedDialog(_profileData?['driver']?['block_reason'] ?? 'Tizim tomonidan cheklangan');
        }
        return;
      }

      await _showStartShiftModal();
    } else {
      await _showStopShiftModal();
    }
  }

  Future<void> _showStartShiftModal() async {
    final vehicle = _profileData?['vehicle'];
    final plate = vehicle?['plate_number'] ?? '60A125UA';
    final model = vehicle?['model'] ?? 'DAMAS';
    final activeShift = _profileData?['active_shift'];
    final int defaultOdo = (activeShift?['last_odometer'] ?? 145200) as int;

    final odoController = TextEditingController(text: defaultOdo.toString());
    bool isChecklistConfirmed = true;

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0B1120),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 16,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(color: const Color(0xFF334155), borderRadius: BorderRadius.circular(2)),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Smenani Boshlash',
                    style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: const Color(0xFF1E293B),
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(color: const Color(0xFF334155)),
                    ),
                    child: Text(
                      '$plate • $model',
                      style: const TextStyle(color: Color(0xFFFACC15), fontWeight: FontWeight.bold, fontSize: 12),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              const Text(
                'Joriy spidometr / odometr ko\'rsatkichi (km):',
                style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: odoController,
                keyboardType: TextInputType.number,
                style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold, letterSpacing: 1),
                decoration: InputDecoration(
                  filled: true,
                  fillColor: const Color(0xFF070B14),
                  prefixIcon: const Icon(Icons.speed_rounded, color: Color(0xFF38BDF8)),
                  suffixText: 'km',
                  suffixStyle: const TextStyle(color: Color(0xFF94A3B8), fontSize: 14),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFF1E293B))),
                  enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFF1E293B))),
                  focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFF38BDF8))),
                ),
              ),
              const SizedBox(height: 14),
              InkWell(
                onTap: () {
                  setModalState(() {
                    isChecklistConfirmed = !isChecklistConfirmed;
                  });
                },
                child: Row(
                  children: [
                    Checkbox(
                      value: isChecklistConfirmed,
                      activeColor: const Color(0xFF10B981),
                      checkColor: Colors.white,
                      onChanged: (val) {
                        setModalState(() {
                          isChecklistConfirmed = val ?? false;
                        });
                      },
                    ),
                    const Expanded(
                      child: Text(
                        'Avtomobil soz holatda, safarga tayyorman',
                        style: TextStyle(color: Color(0xFFCBD5E1), fontSize: 13),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              ElevatedButton.icon(
                onPressed: isChecklistConfirmed
                    ? () async {
                        final enteredOdo = int.tryParse(odoController.text) ?? defaultOdo;
                        Navigator.pop(ctx);
                        HapticFeedback.mediumImpact();
                        await _executeStartShift(enteredOdo);
                      }
                    : null,
                icon: const Icon(Icons.play_arrow_rounded, color: Colors.white, size: 22),
                label: const Text('Smenani Boshlash', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF10B981),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _executeStartShift(int odo) async {
    final virtualGpsId = _profileData?['vehicle']?['virtual_gps_id'] ?? '9170121311';
    final now = DateTime.now();

    setState(() {
      _isShiftActive = true;
      _startOdometer = odo;
      _shiftDistanceKm = 0.0;
      _lastPosition = null;
    });

    _startShiftTimer(now);
    _startLiveTelemetry(virtualGpsId);
    await BackgroundTrackerManager.startShift(virtualGpsId: virtualGpsId);

    try {
      await ApiService().startShift(virtualGpsId: virtualGpsId, odometer: odo);
    } catch (e) {
      debugPrint('[API-SHIFT-START-ERR] $e');
    }

    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('pref_is_shift_active', true);
    await prefs.setString('pref_shift_start_time', now.toIso8601String());
    await prefs.setInt('pref_start_odometer', odo);

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Smena boshlandi! GPS kuzatuv faollashdi.'),
          backgroundColor: Color(0xFF10B981),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  Future<void> _showStopShiftModal() async {
    final vehicle = _profileData?['vehicle'];
    final plate = vehicle?['plate_number'] ?? '60A125UA';
    final int startOdo = _startOdometer ?? 145000;
    final int estimatedEndOdo = startOdo + _shiftDistanceKm.round();

    final odoController = TextEditingController(text: estimatedEndOdo.toString());
    String? validationError;

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0B1120),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 16,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(color: const Color(0xFF334155), borderRadius: BorderRadius.circular(2)),
                ),
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text(
                    'Smenani Yakunlash',
                    style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                  Text(
                    plate,
                    style: const TextStyle(color: Color(0xFFFACC15), fontWeight: FontWeight.bold, fontSize: 13),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              // Summary box
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFF070B14),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFF1E293B)),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    Column(
                      children: [
                        const Text('Smena vaqti', style: TextStyle(color: Color(0xFF64748B), fontSize: 11)),
                        const SizedBox(height: 4),
                        Text(_shiftDurationStr, style: const TextStyle(color: Color(0xFF38BDF8), fontWeight: FontWeight.bold, fontSize: 14)),
                      ],
                    ),
                    Container(width: 1, height: 28, color: const Color(0xFF1E293B)),
                    Column(
                      children: [
                        const Text('GPS masofa', style: TextStyle(color: Color(0xFF64748B), fontSize: 11)),
                        const SizedBox(height: 4),
                        Text('${_shiftDistanceKm.toStringAsFixed(1)} km', style: const TextStyle(color: Color(0xFF10B981), fontWeight: FontWeight.bold, fontSize: 14)),
                      ],
                    ),
                    Container(width: 1, height: 28, color: const Color(0xFF1E293B)),
                    Column(
                      children: [
                        const Text('Boshlang\'ich', style: TextStyle(color: Color(0xFF64748B), fontSize: 11)),
                        const SizedBox(height: 4),
                        Text('$startOdo km', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),
              const Text(
                'Yakuniy spidometr ko\'rsatkichi (km):',
                style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: odoController,
                keyboardType: TextInputType.number,
                style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold, letterSpacing: 1),
                onChanged: (val) {
                  final endVal = int.tryParse(val);
                  setModalState(() {
                    if (endVal != null && endVal < startOdo) {
                      validationError = 'Yakuniy ko\'rsatkich $startOdo km dan kam bo\'lishi mumkin emas!';
                    } else {
                      validationError = null;
                    }
                  });
                },
                decoration: InputDecoration(
                  filled: true,
                  fillColor: const Color(0xFF070B14),
                  prefixIcon: const Icon(Icons.flag_rounded, color: Color(0xFFEF4444)),
                  suffixText: 'km',
                  suffixStyle: const TextStyle(color: Color(0xFF94A3B8), fontSize: 14),
                  errorText: validationError,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFF1E293B))),
                  enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFF1E293B))),
                  focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFFEF4444))),
                ),
              ),
              const SizedBox(height: 18),
              ElevatedButton.icon(
                onPressed: validationError == null
                    ? () async {
                        final endVal = int.tryParse(odoController.text) ?? estimatedEndOdo;
                        if (endVal < startOdo) {
                          setModalState(() {
                            validationError = 'Yakuniy ko\'rsatkich $startOdo km dan katta bo\'lishi shart!';
                          });
                          return;
                        }
                        Navigator.pop(ctx);
                        HapticFeedback.heavyImpact();
                        await _executeStopShift(endVal);
                      }
                    : null,
                icon: const Icon(Icons.stop_rounded, color: Colors.white, size: 22),
                label: const Text('Smenani Yakunlash', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15)),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFEF4444),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _executeStopShift(int endOdo) async {
    _stopLiveTelemetry();
    _shiftTimer?.cancel();
    _shiftTimer = null;
    await BackgroundTrackerManager.stopShift();

    final virtualGpsId = _profileData?['vehicle']?['virtual_gps_id'] ?? '9170121311';
    final int diffKm = endOdo - (_startOdometer ?? endOdo);

    try {
      await ApiService().stopShift(virtualGpsId: virtualGpsId, odometer: endOdo);
    } catch (e) {
      debugPrint('[API-SHIFT-STOP-ERR] $e');
    }

    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('pref_is_shift_active', false);
    await prefs.remove('pref_shift_start_time');
    await prefs.remove('pref_start_odometer');

    setState(() {
      _isShiftActive = false;
      _isServerConnected = false;
      _currentSpeed = 0.0;
    });

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Smena yakunlandi! Bosib o\'tilgan masofa: $diffKm km.'),
          backgroundColor: const Color(0xFF0284C7),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  void _showBlockedDialog(String reason) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF1E293B),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.gpp_bad, color: Colors.redAccent, size: 28),
            SizedBox(width: 8),
            Text('Transport Bloklangan!', style: TextStyle(color: Colors.white, fontSize: 18)),
          ],
        ),
        content: Text(
          'Sababi: $reason\n\nIltimos, oylik to\'lovni to\'lang yoki litsenziya/sug\'urta muddatini yangilang.',
          style: const TextStyle(color: Color(0xFFCBD5E1), fontSize: 14),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Tushundim', style: TextStyle(color: Colors.blueAccent)),
          ),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(ctx);
              _showPaymentModal();
            },
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF10B981)),
            child: const Text('To\'lov qilish', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }

  Future<void> _callDispatcher() async {
    final phone = _profileData?['tenant']?['dispatcher_phone'] ?? '+998901234567';
    await ApiService().logDispatcherCall();
    final Uri url = Uri.parse('tel:$phone');
    if (await canLaunchUrl(url)) {
      await launchUrl(url);
    }
  }

  void _showPaymentModal() {
    final vehicle = _profileData?['vehicle'];
    final plate = vehicle?['plate_number'] ?? '60A125UA';
    final balance = _profileData?['financial']?['balance'] ?? 0;
    final company = _profileData?['company_info'];
    final cardNumber = company?['card_number'] ?? '8600 0423 1122 3344';

    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1E293B),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(width: 40, height: 4, decoration: BoxDecoration(color: Colors.grey[700], borderRadius: BorderRadius.circular(2))),
            ),
            const SizedBox(height: 16),
            const Text(
              'Oylik To\'lovni Amalga Oshirish',
              style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(
              'Transport: $plate | Joriy balans: ${balance.toString()} so\'m',
              style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
            ),
            const SizedBox(height: 14),

            // Card quick-copy box
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF070B14),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFF334155)),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Karta raqami (CARLUX MCHJ):', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 10)),
                      const SizedBox(height: 2),
                      Text(
                        cardNumber,
                        style: const TextStyle(color: Color(0xFFFACC15), fontWeight: FontWeight.bold, fontSize: 13, letterSpacing: 1),
                      ),
                    ],
                  ),
                  IconButton(
                    icon: const Icon(Icons.copy, color: Color(0xFF38BDF8), size: 18),
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: cardNumber.replaceAll(' ', '')));
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Karta raqami nusxalandi!'),
                          backgroundColor: Color(0xFF0284C7),
                          behavior: SnackBarBehavior.floating,
                        ),
                      );
                    },
                  ),
                ],
              ),
            ),

            const SizedBox(height: 18),

            // Payme tugmasi
            ElevatedButton.icon(
              onPressed: () async {
                Navigator.pop(ctx);
                await ApiService().logPaymentInitiated('PAYME', 350000.0);
                final paymeUrl = Uri.parse('https://checkout.paycom.uz');
                await launchUrl(paymeUrl, mode: LaunchMode.externalApplication);
              },
              icon: const Icon(Icons.payment, color: Colors.white),
              label: const Text('Payme orqali to\'lash', style: TextStyle(fontWeight: FontWeight.bold)),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF00CCCC),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
            const SizedBox(height: 12),

            // Click tugmasi
            ElevatedButton.icon(
              onPressed: () async {
                Navigator.pop(ctx);
                await ApiService().logPaymentInitiated('CLICK', 350000.0);
                final clickUrl = Uri.parse('https://my.click.uz');
                await launchUrl(clickUrl, mode: LaunchMode.externalApplication);
              },
              icon: const Icon(Icons.credit_card, color: Colors.white),
              label: const Text('Click orqali to\'lash', style: TextStyle(fontWeight: FontWeight.bold)),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF0073FF),
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Color get _speedColor {
    if (!_isShiftActive) return const Color(0xFF64748B);
    if (_currentSpeed > 70.0) return const Color(0xFFEF4444);
    if (_currentSpeed > 60.0) return const Color(0xFFF59E0B);
    return const Color(0xFF10B981);
  }

  String get _speedStatusLabel {
    if (!_isShiftActive) return 'TRANSPORT TO\'XTAB TURIBDI';
    if (_currentSpeed > 70.0) return 'OGOHLANTIRISH: CHEKLOVDAN OSHILDI (>70 km/s)';
    if (_currentSpeed > 60.0) return 'EHTIYOT BO\'LING (60 - 70 km/s)';
    return 'XAVFSIZ VA ME\'YORDA (JONLI TEZLIK)';
  }

  @override
  Widget build(BuildContext context) {
    final driver = _profileData?['driver'];
    final vehicle = _profileData?['vehicle'];
    final tenant = _profileData?['tenant'];
    final isBlocked = driver?['is_blocked'] ?? false;

    return Scaffold(
      backgroundColor: const Color(0xFF070B14),
      appBar: AppBar(
        backgroundColor: const Color(0xFF070B14),
        elevation: 0,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(
            color: const Color(0xFF1E293B),
            height: 1,
          ),
        ),
        title: Row(
          children: [
            Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(9),
                border: Border.all(color: const Color(0xFF1E293B)),
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.asset(
                  'assets/images/logo.png',
                  width: 32,
                  height: 32,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => const Icon(Icons.directions_car, color: Color(0xFF38BDF8), size: 24),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    tenant?['name'] ?? 'UYUSHMACHILAR',
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: Colors.white, letterSpacing: 0.3),
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    driver?['full_name'] ?? 'Shohijahon Mirzarxmatov',
                    style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8), fontWeight: FontWeight.w500),
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.qr_code_2_rounded, color: Color(0xFF38BDF8), size: 24),
            tooltip: "Elektron Yo'l Varaqasi",
            onPressed: () {
              showWaybillSheet(context, profileData: _profileData);
            },
          ),
          IconButton(
            icon: const Icon(Icons.badge_outlined, color: Color(0xFF94A3B8), size: 22),
            tooltip: 'Yagona Profil',
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => UnifiedProfileScreen(initialProfile: _profileData)),
              );
            },
          ),
          IconButton(
            icon: const Icon(Icons.logout_rounded, color: Color(0xFF64748B), size: 22),
            tooltip: 'Chiqish',
            onPressed: () async {
              await ApiService().logout();
              if (context.mounted) {
                Navigator.of(context).pushReplacement(
                  MaterialPageRoute(builder: (_) => const LoginScreen()),
                );
              }
            },
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF38BDF8)))
          : RefreshIndicator(
              onRefresh: _loadProfile,
              color: const Color(0xFF38BDF8),
              backgroundColor: const Color(0xFF0B1120),
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 14.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // 1. Sleek Status Capsule
                    if (isBlocked)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                        decoration: BoxDecoration(
                          color: const Color(0xFF450A0A).withValues(alpha: 0.6),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFFEF4444).withValues(alpha: 0.5)),
                        ),
                        child: Row(
                          children: [
                            Container(
                              width: 8,
                              height: 8,
                              decoration: const BoxDecoration(
                                color: Color(0xFFEF4444),
                                shape: BoxShape.circle,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text(
                                    'HARAKAT CHEKLANGAN (BLOK)',
                                    style: TextStyle(color: Color(0xFFFCA5A5), fontWeight: FontWeight.bold, fontSize: 12),
                                  ),
                                  Text(
                                    driver?['block_reason'] ?? 'Qarzdorlik yoki hujjat muddati o\'tgan.',
                                    style: const TextStyle(color: Color(0xFFF87171), fontSize: 11),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      )
                    else
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        decoration: BoxDecoration(
                          color: const Color(0xFF06231A),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: const Color(0xFF059669).withValues(alpha: 0.4)),
                        ),
                        child: Row(
                          children: [
                            Container(
                              width: 8,
                              height: 8,
                              decoration: BoxDecoration(
                                color: const Color(0xFF10B981),
                                shape: BoxShape.circle,
                                boxShadow: [
                                  BoxShadow(
                                    color: const Color(0xFF10B981).withValues(alpha: 0.6),
                                    blurRadius: 6,
                                    spreadRadius: 1,
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 10),
                            const Expanded(
                              child: Text(
                                'HUJJATLAR & BALANS JOYIDA • RUXSAT ETILGAN',
                                style: TextStyle(
                                  color: Color(0xFFA7F3D0),
                                  fontWeight: FontWeight.w700,
                                  fontSize: 11,
                                  letterSpacing: 0.5,
                                ),
                              ),
                            ),
                            const Icon(Icons.check_circle_rounded, color: Color(0xFF10B981), size: 16),
                          ],
                        ),
                      ),

                    const SizedBox(height: 14),

                    // 2. Haydovchi va Transport Profili Karta
                    InkWell(
                      onTap: () {
                        Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => UnifiedProfileScreen(initialProfile: _profileData),
                          ),
                        );
                      },
                      borderRadius: BorderRadius.circular(18),
                      child: Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [Color(0xFF0F172A), Color(0xFF0B1120)],
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          ),
                          borderRadius: BorderRadius.circular(18),
                          border: Border.all(color: const Color(0xFF1E293B)),
                        ),
                        child: Column(
                          children: [
                            Row(
                              children: [
                                Container(
                                  width: 54,
                                  height: 54,
                                  decoration: BoxDecoration(
                                    shape: BoxShape.circle,
                                    border: Border.all(color: const Color(0xFF38BDF8), width: 1.8),
                                    boxShadow: [
                                      BoxShadow(
                                        color: const Color(0xFF38BDF8).withValues(alpha: 0.2),
                                        blurRadius: 10,
                                        spreadRadius: 1,
                                      ),
                                    ],
                                  ),
                                  child: ClipOval(
                                    child: (driver?['photo_url'] != null && driver!['photo_url'].toString().isNotEmpty)
                                        ? Image.network(
                                            driver['photo_url'].toString(),
                                            width: 54,
                                            height: 54,
                                            fit: BoxFit.cover,
                                            errorBuilder: (_, __, ___) => _buildFallbackAvatar(driver?['full_name'] ?? 'H', 54),
                                            loadingBuilder: (ctx, child, progress) {
                                              if (progress == null) return child;
                                              return _buildFallbackAvatar(driver?['full_name'] ?? 'H', 54);
                                            },
                                          )
                                        : _buildFallbackAvatar(driver?['full_name'] ?? 'H', 54),
                                  ),
                                ),
                                const SizedBox(width: 14),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        children: [
                                          Flexible(
                                            child: Text(
                                              driver?['full_name'] ?? 'Shohijahon Mirzarxmatov',
                                              style: const TextStyle(
                                                color: Colors.white,
                                                fontWeight: FontWeight.bold,
                                                fontSize: 16,
                                              ),
                                              overflow: TextOverflow.ellipsis,
                                            ),
                                          ),
                                          const SizedBox(width: 6),
                                          const Icon(Icons.verified_rounded, color: Color(0xFF38BDF8), size: 16),
                                        ],
                                      ),
                                      const SizedBox(height: 3),
                                      Text(
                                        driver?['phone'] ?? '+998 91 127 89 02',
                                        style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
                                      ),
                                    ],
                                  ),
                                ),
                                const Icon(Icons.arrow_forward_ios_rounded, color: Color(0xFF475569), size: 14),
                              ],
                            ),
                            const SizedBox(height: 14),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                              decoration: BoxDecoration(
                                color: const Color(0xFF070B14),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: const Color(0xFF1E293B)),
                              ),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Row(
                                    children: [
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                        decoration: BoxDecoration(
                                          color: const Color(0xFF1E293B),
                                          borderRadius: BorderRadius.circular(6),
                                          border: Border.all(color: const Color(0xFF334155)),
                                        ),
                                        child: Text(
                                          vehicle?['plate_number'] ?? '60A125UA',
                                          style: const TextStyle(
                                            color: Colors.white,
                                            fontWeight: FontWeight.w900,
                                            fontSize: 13,
                                            letterSpacing: 0.5,
                                          ),
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      Text(
                                        vehicle?['model'] ?? 'DAMAS',
                                        style: const TextStyle(
                                          color: Color(0xFF94A3B8),
                                          fontSize: 12,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ],
                                  ),
                                  Row(
                                    children: [
                                      const Text(
                                        'GPS ID: ',
                                        style: TextStyle(color: Color(0xFF64748B), fontSize: 11),
                                      ),
                                      Text(
                                        vehicle?['virtual_gps_id'] ?? '9170121311',
                                        style: const TextStyle(
                                          color: Color(0xFF38BDF8),
                                          fontSize: 12,
                                          fontWeight: FontWeight.w700,
                                          letterSpacing: 0.5,
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),

                    const SizedBox(height: 14),

                    // 3. Rasmiy Elektron Yo'l Varaqasi Karta
                    InkWell(
                      onTap: () => showWaybillSheet(context, profileData: _profileData),
                      borderRadius: BorderRadius.circular(18),
                      child: Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [Color(0xFF0C1D30), Color(0xFF0B1120)],
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          ),
                          borderRadius: BorderRadius.circular(18),
                          border: Border.all(color: const Color(0xFF0284C7).withValues(alpha: 0.4)),
                        ),
                        child: Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: const Color(0xFF0284C7).withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(color: const Color(0xFF38BDF8).withValues(alpha: 0.5)),
                              ),
                              child: const Icon(Icons.qr_code_2_rounded, color: Color(0xFF38BDF8), size: 30),
                            ),
                            const SizedBox(width: 14),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      const Text(
                                        'ELEKTRON YO\'L VARAQASI',
                                        style: TextStyle(
                                          color: Colors.white,
                                          fontWeight: FontWeight.w900,
                                          fontSize: 12,
                                          letterSpacing: 0.6,
                                        ),
                                      ),
                                      const SizedBox(width: 6),
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                        decoration: BoxDecoration(
                                          color: const Color(0xFF10B981).withValues(alpha: 0.2),
                                          borderRadius: BorderRadius.circular(4),
                                        ),
                                        child: const Text('AMALDA', style: TextStyle(color: Color(0xFF34D399), fontSize: 9, fontWeight: FontWeight.bold)),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    '№ ${_profileData?['waybill']?['number'] ?? 'YV-26-86964'} • QR tekshiruv',
                                    style: const TextStyle(color: Color(0xFF38BDF8), fontSize: 12, fontWeight: FontWeight.w600),
                                  ),
                                  const SizedBox(height: 2),
                                  const Text(
                                    'YHXBB (GAI) / Transport Nazorati tekshiruvi uchun',
                                    style: TextStyle(color: Color(0xFF64748B), fontSize: 11),
                                  ),
                                ],
                              ),
                            ),
                            const Icon(Icons.arrow_forward_ios_rounded, color: Color(0xFF475569), size: 14),
                          ],
                        ),
                      ),
                    ),

                    const SizedBox(height: 14),

                    // 4. Smena & Tesla-style Telemetriya Klasteri
                    Container(
                      padding: const EdgeInsets.all(18),
                      decoration: BoxDecoration(
                        color: const Color(0xFF0B1120),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: _isShiftActive ? const Color(0xFF10B981).withValues(alpha: 0.6) : const Color(0xFF1E293B),
                          width: _isShiftActive ? 1.5 : 1,
                        ),
                        boxShadow: [
                          if (_isShiftActive)
                            BoxShadow(
                              color: const Color(0xFF10B981).withValues(alpha: 0.1),
                              blurRadius: 20,
                              offset: const Offset(0, 4),
                            ),
                        ],
                      ),
                      child: Column(
                        children: [
                          // Smena status va switch
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Row(
                                children: [
                                  Container(
                                    width: 10,
                                    height: 10,
                                    decoration: BoxDecoration(
                                      color: _isShiftActive ? const Color(0xFF10B981) : const Color(0xFF64748B),
                                      shape: BoxShape.circle,
                                      boxShadow: _isShiftActive
                                          ? [
                                              BoxShadow(
                                                color: const Color(0xFF10B981).withValues(alpha: 0.6),
                                                blurRadius: 8,
                                                spreadRadius: 2,
                                              )
                                            ]
                                          : null,
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        _isShiftActive ? 'SMENA FAOL' : 'SMENA NOFAOL',
                                        style: TextStyle(
                                          color: _isShiftActive ? const Color(0xFF34D399) : const Color(0xFF94A3B8),
                                          fontWeight: FontWeight.w900,
                                          fontSize: 16,
                                          letterSpacing: 0.8,
                                        ),
                                      ),
                                      Text(
                                        _isShiftActive
                                            ? 'GPS H02 protokoli uzatilmoqda'
                                            : 'Kuzatuvni boshlash uchun yoqing',
                                        style: const TextStyle(color: Color(0xFF64748B), fontSize: 11),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                              Switch.adaptive(
                                value: _isShiftActive,
                                activeTrackColor: const Color(0xFF10B981),
                                onChanged: _toggleShift,
                              ),
                            ],
                          ),

                          const SizedBox(height: 18),

                          // Tesla-style Speedometer
                          Container(
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            decoration: BoxDecoration(
                              color: const Color(0xFF070B14),
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: _isShiftActive && _currentSpeed > 70
                                    ? const Color(0xFFEF4444)
                                    : const Color(0xFF1E293B),
                              ),
                            ),
                            child: Column(
                              children: [
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  crossAxisAlignment: CrossAxisAlignment.baseline,
                                  textBaseline: TextBaseline.alphabetic,
                                  children: [
                                    Text(
                                      _currentSpeed.toStringAsFixed(1),
                                      style: TextStyle(
                                        color: _speedColor,
                                        fontSize: 48,
                                        fontWeight: FontWeight.w900,
                                        letterSpacing: -1,
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    Text(
                                      'km/s',
                                      style: TextStyle(
                                        color: _isShiftActive ? const Color(0xFF38BDF8) : const Color(0xFF475569),
                                        fontSize: 14,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  _speedStatusLabel,
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    color: _speedColor,
                                    fontSize: 10,
                                    fontWeight: FontWeight.w700,
                                    letterSpacing: 1.1,
                                  ),
                                ),
                              ],
                            ),
                          ),

                          const SizedBox(height: 14),

                          // Telemetriya ko'rsatkichlari (4-lik grid: 2x2)
                          Row(
                            children: [
                              Expanded(
                                child: _buildMinimalMetric(
                                  label: 'Smena Vaqti',
                                  value: _isShiftActive ? _shiftDurationStr : '00:00:00',
                                  unit: '',
                                  icon: Icons.timer_outlined,
                                  color: const Color(0xFF38BDF8),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: _buildMinimalMetric(
                                  label: 'Smena Masofasi',
                                  value: _shiftDistanceKm.toStringAsFixed(1),
                                  unit: 'km',
                                  icon: Icons.route_rounded,
                                  color: const Color(0xFF10B981),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Row(
                            children: [
                              Expanded(
                                child: _buildMinimalMetric(
                                  label: 'Paketlar',
                                  value: '$_packetsSent',
                                  unit: 'ta',
                                  icon: Icons.cloud_upload_outlined,
                                  color: const Color(0xFFA78BFA),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: _buildMinimalMetric(
                                  label: 'GPS Aniqlik',
                                  value: _isShiftActive ? '±${_gpsAccuracyMeters.toStringAsFixed(1)}' : '—',
                                  unit: _isShiftActive ? 'm' : '',
                                  icon: Icons.my_location_rounded,
                                  color: const Color(0xFF38BDF8),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: _buildMinimalMetric(
                                  label: 'Server',
                                  value: _connectionType == 'TCP_20335'
                                      ? 'TCP'
                                      : (_connectionType == 'HTTPS_PING'
                                          ? 'HTTPS'
                                          : (_isShiftActive ? 'KUTILMOQDA' : 'O\'CHIQ')),
                                  unit: '',
                                  icon: Icons.wifi_rounded,
                                  color: _isServerConnected
                                      ? const Color(0xFF10B981)
                                      : (_isShiftActive ? const Color(0xFF38BDF8) : const Color(0xFFF59E0B)),
                                ),
                              ),
                            ],
                          ),

                          if (_offlineCachedCount > 0) ...[
                            const SizedBox(height: 12),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF59E0B).withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(color: const Color(0xFFF59E0B).withValues(alpha: 0.3)),
                              ),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  const Icon(Icons.cloud_off_rounded, color: Color(0xFFF59E0B), size: 16),
                                  const SizedBox(width: 8),
                                  Text(
                                    'Oflayn kesh: $_offlineCachedCount ta nuqta navbatda',
                                    style: const TextStyle(color: Color(0xFFFBBF24), fontSize: 11, fontWeight: FontWeight.w600),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),

                    const SizedBox(height: 16),

                    // 5. Tezkor Amallar Tugmalari
                    Row(
                      children: [
                        Expanded(
                          child: InkWell(
                            onTap: _showPaymentModal,
                            borderRadius: BorderRadius.circular(14),
                            child: Container(
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              decoration: BoxDecoration(
                                gradient: const LinearGradient(
                                  colors: [Color(0xFF059669), Color(0xFF10B981)],
                                  begin: Alignment.topLeft,
                                  end: Alignment.bottomRight,
                                ),
                                borderRadius: BorderRadius.circular(14),
                                boxShadow: [
                                  BoxShadow(
                                    color: const Color(0xFF10B981).withValues(alpha: 0.25),
                                    blurRadius: 10,
                                    offset: const Offset(0, 3),
                                  ),
                                ],
                              ),
                              child: const Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(Icons.account_balance_wallet_rounded, color: Colors.white, size: 18),
                                  SizedBox(width: 8),
                                  Text(
                                    'To\'lov qilish',
                                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: InkWell(
                            onTap: _callDispatcher,
                            borderRadius: BorderRadius.circular(14),
                            child: Container(
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              decoration: BoxDecoration(
                                gradient: const LinearGradient(
                                  colors: [Color(0xFF0284C7), Color(0xFF2563EB)],
                                  begin: Alignment.topLeft,
                                  end: Alignment.bottomRight,
                                ),
                                borderRadius: BorderRadius.circular(14),
                                boxShadow: [
                                  BoxShadow(
                                    color: const Color(0xFF2563EB).withValues(alpha: 0.25),
                                    blurRadius: 10,
                                    offset: const Offset(0, 3),
                                  ),
                                ],
                              ),
                              child: const Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(Icons.headset_mic_rounded, color: Colors.white, size: 18),
                                  SizedBox(width: 8),
                                  Text(
                                    'Dispetcher',
                                    style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                  ],
                ),
              ),
            ),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: Color(0xFF070B14),
          border: Border(
            top: BorderSide(color: Color(0xFF1E293B), width: 1),
          ),
        ),
        child: BottomNavigationBar(
          backgroundColor: const Color(0xFF070B14),
          elevation: 0,
          selectedItemColor: const Color(0xFF38BDF8),
          unselectedItemColor: const Color(0xFF64748B),
          selectedLabelStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 11),
          unselectedLabelStyle: const TextStyle(fontSize: 11),
          currentIndex: 0,
          onTap: (index) {
            if (index == 1) {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => UnifiedProfileScreen(initialProfile: _profileData),
                ),
              );
            }
          },
          items: const [
            BottomNavigationBarItem(
              icon: Icon(Icons.dashboard_rounded),
              label: 'Boshqaruv',
            ),
            BottomNavigationBarItem(
              icon: Icon(Icons.badge_rounded),
              label: 'Mening Profilim',
            ),
          ],
        ),
      ),
    );
  }

  String _getInitials(String name) {
    final parts = name.trim().split(' ');
    if (parts.isEmpty) return 'H';
    if (parts.length == 1) return parts[0].substring(0, 1).toUpperCase();
    return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
  }

  Widget _buildFallbackAvatar(String name, double size) {
    return Container(
      width: size,
      height: size,
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        gradient: LinearGradient(
          colors: [Color(0xFF38BDF8), Color(0xFF2563EB)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Center(
        child: Text(
          _getInitials(name),
          style: TextStyle(
            color: Colors.white,
            fontSize: size * 0.38,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
    );
  }

  Widget _buildMinimalMetric({
    required String label,
    required String value,
    required String unit,
    required IconData icon,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF070B14),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: const Color(0xFF1E293B)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color, size: 14),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  label,
                  style: const TextStyle(color: Color(0xFF64748B), fontSize: 10, fontWeight: FontWeight.w500),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Flexible(
                child: Text(
                  value,
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 12),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (unit.isNotEmpty) ...[
                const SizedBox(width: 3),
                Text(
                  unit,
                  style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 10),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}
