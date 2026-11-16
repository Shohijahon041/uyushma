import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
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
  bool _isShiftActive = false;
  bool _isLoading = true;
  Map<String, dynamic>? _profileData;

  // Jonli GPS ko'rsatkichlari
  double _currentSpeed = 0.0;
  double _latitude = 41.2995;
  double _longitude = 69.2401;
  int _packetsSent = 0;
  bool _isServerConnected = false;
  int _offlineCachedCount = 0;

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
    super.dispose();
  }

  Future<void> _checkInitialShiftState() async {
    final prefs = await SharedPreferences.getInstance();
    final isActive = prefs.getBool('pref_is_shift_active') ?? false;
    final virtualGpsId = prefs.getString('pref_virtual_gps_id') ?? '9012345678';
    if (mounted) {
      setState(() {
        _isShiftActive = isActive;
      });
    }
    if (isActive) {
      _startLiveTelemetry(virtualGpsId);
    }
  }

  void _listenBackgroundService() {
    FlutterBackgroundService().on('GPS_UPDATE').listen((event) {
      if (event != null && mounted) {
        setState(() {
          _latitude = event['latitude'] ?? _latitude;
          _longitude = event['longitude'] ?? _longitude;
          _currentSpeed = event['speed'] ?? _currentSpeed;
          _packetsSent = event['packets'] ?? _packetsSent;
          _isServerConnected = event['connected'] ?? _isServerConnected;
          _offlineCachedCount = event['offline_cached'] ?? _offlineCachedCount;
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
        setState(() {
          _latitude = pos.latitude;
          _longitude = pos.longitude;
          _currentSpeed = (pos.speed * 3.6).clamp(0.0, 250.0);
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
          }
        } catch (_) {}
      }

      if (mounted) {
        setState(() {
          _latitude = lat;
          _longitude = lon;
          _currentSpeed = speed;
          if (connected) {
            _packetsSent++;
            _isServerConnected = true;
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
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
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

      final virtualGpsId = _profileData?['vehicle']?['virtual_gps_id'] ?? '9012345678';
      setState(() {
        _isShiftActive = true;
        _isServerConnected = false;
      });

      // To'g'ridan-to'g'ri faol telemetriyani boshlash
      _startLiveTelemetry(virtualGpsId);

      // Fon xizmatini yoqish
      await BackgroundTrackerManager.startShift(virtualGpsId: virtualGpsId);
      try {
        await ApiService().startShift(virtualGpsId: virtualGpsId);
      } catch (e) {
        debugPrint('[API-SHIFT-START-ERR] $e');
      }
    } else {
      _stopLiveTelemetry();
      await BackgroundTrackerManager.stopShift();
      final virtualGpsId = _profileData?['vehicle']?['virtual_gps_id'] ?? '9012345678';
      try {
        await ApiService().stopShift(virtualGpsId: virtualGpsId);
      } catch (e) {
        debugPrint('[API-SHIFT-STOP-ERR] $e');
      }
      setState(() {
        _isShiftActive = false;
        _isServerConnected = false;
        _currentSpeed = 0.0;
      });
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
    final plate = vehicle?['plate_number'] ?? '01A777AA';
    final balance = _profileData?['financial']?['balance'] ?? 0;

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
            const SizedBox(height: 24),

            // Payme tugmasi
            ElevatedButton.icon(
              onPressed: () async {
                Navigator.pop(ctx);
                await ApiService().logPaymentInitiated('PAYME', 350000.0);
                // Payme Checkout URL
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
                // Click Checkout URL
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

  @override
  Widget build(BuildContext context) {
    final driver = _profileData?['driver'];
    final vehicle = _profileData?['vehicle'];
    final tenant = _profileData?['tenant'];
    final isBlocked = driver?['is_blocked'] ?? false;

    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        elevation: 0,
        title: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Image.asset(
                'assets/images/logo.png',
                width: 32,
                height: 32,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => const Icon(Icons.directions_car, color: Color(0xFF38BDF8), size: 24),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    tenant?['name'] ?? 'UYUSHMACHILAR',
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.white),
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    driver?['full_name'] ?? 'Haydovchi',
                    style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8)),
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.qr_code_2, color: Color(0xFF34D399)),
            tooltip: "Elektron Yo'l Varaqasi",
            onPressed: () {
              showWaybillSheet(context, profileData: _profileData);
            },
          ),
          IconButton(
            icon: const Icon(Icons.badge_outlined, color: Color(0xFF38BDF8)),
            tooltip: 'Yagona Profil',
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => UnifiedProfileScreen(initialProfile: _profileData)),
              );
            },
          ),
          IconButton(
            icon: const Icon(Icons.logout, color: Color(0xFF94A3B8)),
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
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF3B82F6)))
          : RefreshIndicator(
              onRefresh: _loadProfile,
              color: const Color(0xFF3B82F6),
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // 1. Bloklanganlik / Faollik holat banneri
                    if (isBlocked)
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: const Color(0xFF450A0A),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: const Color(0xFF991B1B)),
                        ),
                        child: Row(
                          children: [
                            const Icon(Icons.warning_amber_rounded, color: Color(0xFFEF4444), size: 36),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text(
                                    'HARAKAT CHEKLANGAN (BLOK)',
                                    style: TextStyle(color: Color(0xFFFCA5A5), fontWeight: FontWeight.bold, fontSize: 14),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    driver?['block_reason'] ?? 'Qarzdorlik yoki hujjat muddati o\'tgan.',
                                    style: const TextStyle(color: Color(0xFFF87171), fontSize: 12),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      )
                    else
                      Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: const Color(0xFF064E3B),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: const Color(0xFF059669)),
                        ),
                        child: const Row(
                          children: [
                            Icon(Icons.check_circle_outline, color: Color(0xFF34D399), size: 28),
                            SizedBox(width: 12),
                            Text(
                              'Hujjatlar va Balans Joyida (Ruxsat etilgan)',
                              style: TextStyle(color: Color(0xFFA7F3D0), fontWeight: FontWeight.w600, fontSize: 13),
                            ),
                          ],
                        ),
                      ),

                    const SizedBox(height: 16),

                    // 1.5. Haydovchi va Transport Profili Katta Banneri
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
                            colors: [Color(0xFF1E293B), Color(0xFF0F172A)],
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          ),
                          borderRadius: BorderRadius.circular(18),
                          border: Border.all(color: const Color(0xFF38BDF8).withValues(alpha: 0.5), width: 1.2),
                          boxShadow: [
                            BoxShadow(
                              color: const Color(0xFF0284C7).withValues(alpha: 0.15),
                              blurRadius: 12,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: Row(
                          children: [
                            Container(
                              width: 52,
                              height: 52,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                border: Border.all(color: const Color(0xFF38BDF8), width: 2),
                                boxShadow: [
                                  BoxShadow(
                                    color: const Color(0xFF38BDF8).withValues(alpha: 0.25),
                                    blurRadius: 10,
                                    offset: const Offset(0, 3),
                                  ),
                                ],
                              ),
                              child: ClipOval(
                                child: (driver?['photo_url'] != null && driver!['photo_url'].toString().isNotEmpty)
                                    ? Image.network(
                                        driver['photo_url'].toString(),
                                        width: 52,
                                        height: 52,
                                        fit: BoxFit.cover,
                                        errorBuilder: (_, __, ___) => _buildFallbackAvatar(driver?['full_name'] ?? 'H', 52),
                                        loadingBuilder: (ctx, child, progress) {
                                          if (progress == null) return child;
                                          return _buildFallbackAvatar(driver?['full_name'] ?? 'H', 52);
                                        },
                                      )
                                    : _buildFallbackAvatar(driver?['full_name'] ?? 'H', 52),
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
                                          driver?['full_name'] ?? 'Jamshid Karimov',
                                          style: const TextStyle(
                                            color: Colors.white,
                                            fontWeight: FontWeight.bold,
                                            fontSize: 15,
                                          ),
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                      const SizedBox(width: 6),
                                      const Icon(Icons.verified, color: Color(0xFF38BDF8), size: 16),
                                    ],
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    driver?['phone'] ?? '+998 90 111-22-33',
                                    style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                                  ),
                                  const SizedBox(height: 4),
                                  const Row(
                                    children: [
                                      Text(
                                        'Davlat integratsiyalari va hujjatlar',
                                        style: TextStyle(color: Color(0xFF34D399), fontSize: 11, fontWeight: FontWeight.w600),
                                      ),
                                      SizedBox(width: 4),
                                      Icon(Icons.arrow_forward_ios, color: Color(0xFF34D399), size: 10),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),

                    // 1.8. Rasmiy Elektron Yo'l Varaqasi Karta
                    InkWell(
                      onTap: () => showWaybillSheet(context, profileData: _profileData),
                      borderRadius: BorderRadius.circular(18),
                      child: Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [Color(0xFF0F2B48), Color(0xFF1E293B)],
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          ),
                          borderRadius: BorderRadius.circular(18),
                          border: Border.all(color: const Color(0xFF38BDF8).withValues(alpha: 0.6), width: 1.2),
                          boxShadow: [
                            BoxShadow(
                              color: const Color(0xFF0284C7).withValues(alpha: 0.2),
                              blurRadius: 10,
                              offset: const Offset(0, 3),
                            ),
                          ],
                        ),
                        child: Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: const Color(0xFF0284C7).withValues(alpha: 0.25),
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(color: const Color(0xFF38BDF8)),
                              ),
                              child: const Icon(Icons.qr_code_2, color: Color(0xFF38BDF8), size: 28),
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
                                        style: TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 13, letterSpacing: 0.5),
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
                                    '№ ${_profileData?['waybill']?['number'] ?? 'YV-26-86964'} • QR-kod bilan',
                                    style: const TextStyle(color: Color(0xFF38BDF8), fontSize: 12, fontWeight: FontWeight.w600),
                                  ),
                                  const SizedBox(height: 2),
                                  const Text(
                                    'GAI / Transport Nazorati inspektoriga ko\'rsatish',
                                    style: TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                                  ),
                                ],
                              ),
                            ),
                            const Icon(Icons.arrow_forward_ios, color: Color(0xFF64748B), size: 16),
                          ],
                        ),
                      ),
                    ),

                    const SizedBox(height: 16),

                    // 2. Smena Boshlash / Tugatish Asosiy Karta
                    Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        color: const Color(0xFF1E293B),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(
                          color: _isShiftActive ? const Color(0xFF10B981) : const Color(0xFF334155),
                          width: _isShiftActive ? 2 : 1,
                        ),
                        boxShadow: [
                          if (_isShiftActive)
                            BoxShadow(
                              color: const Color(0xFF10B981).withValues(alpha: 0.15),
                              blurRadius: 16,
                              offset: const Offset(0, 4),
                            ),
                        ],
                      ),
                      child: Column(
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    _isShiftActive ? 'SMENA FAOL' : 'SMENA NOFAOL',
                                    style: TextStyle(
                                      color: _isShiftActive ? const Color(0xFF34D399) : const Color(0xFF94A3B8),
                                      fontWeight: FontWeight.w900,
                                      fontSize: 18,
                                      letterSpacing: 1,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    _isShiftActive
                                        ? 'H02 paketlari uzatilmoqda'
                                        : 'Kuzatuvni boshlash uchun yoqing',
                                    style: const TextStyle(color: Color(0xFF64748B), fontSize: 12),
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
                          const Divider(color: Color(0xFF334155), height: 32),

                          // Telemetriya ko'rsatkichlari
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceAround,
                            children: [
                              _buildMetric(
                                label: 'Tezlik',
                                value: '${_currentSpeed.toStringAsFixed(1)} km/s',
                                icon: Icons.speed,
                                color: const Color(0xFF60A5FA),
                              ),
                              _buildMetric(
                                label: 'Paketlar',
                                value: '$_packetsSent ta',
                                icon: Icons.cloud_upload_outlined,
                                color: const Color(0xFFA78BFA),
                              ),
                              _buildMetric(
                                label: 'Server Aloqasi',
                                value: _isServerConnected
                                    ? 'ON (20335)'
                                    : (_isShiftActive ? 'Ulanmoqda...' : 'Kutilmoqda'),
                                icon: Icons.wifi,
                                color: _isServerConnected
                                    ? const Color(0xFF34D399)
                                    : (_isShiftActive ? const Color(0xFF60A5FA) : const Color(0xFFFBBF24)),
                              ),
                            ],
                          ),
                          if (_offlineCachedCount > 0) ...[
                            const SizedBox(height: 12),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF59E0B).withAlpha(38),
                                borderRadius: BorderRadius.circular(8),
                                border: Border.all(color: const Color(0xFFF59E0B).withAlpha(100)),
                              ),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  const Icon(Icons.cloud_off_rounded, color: Color(0xFFF59E0B), size: 16),
                                  const SizedBox(width: 8),
                                  Text(
                                    'Oflayn kesh: $_offlineCachedCount ta nuqta saqlangan (Aloqa tiklangach yuboriladi)',
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

                    // 3. Transport Qisqacha Ma'lumoti (Batafsil profilga o'tish)
                    InkWell(
                      onTap: () {
                        Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => UnifiedProfileScreen(initialProfile: _profileData),
                          ),
                        );
                      },
                      borderRadius: BorderRadius.circular(16),
                      child: Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: const Color(0xFF1E293B),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: const Color(0xFF334155)),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.all(10),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFF0F172A),
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  child: const Icon(Icons.directions_car, color: Color(0xFF60A5FA), size: 28),
                                ),
                                const SizedBox(width: 12),
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      vehicle?['plate_number'] ?? '01A777AA',
                                      style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
                                    ),
                                    Text(
                                      vehicle?['model'] ?? 'Chevrolet Cobalt',
                                      style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                const Text('Virtual GPS ID', style: TextStyle(color: Color(0xFF64748B), fontSize: 10)),
                                Text(
                                  vehicle?['virtual_gps_id'] ?? '9012345678',
                                  style: const TextStyle(color: Color(0xFF38BDF8), fontWeight: FontWeight.bold, fontSize: 13),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),

                    const SizedBox(height: 20),

                    // 4. Tezkor Amallar Tugmalari
                    Row(
                      children: [
                        Expanded(
                          child: ElevatedButton.icon(
                            onPressed: _showPaymentModal,
                            icon: const Icon(Icons.account_balance_wallet, size: 20),
                            label: const Text('To\'lov qilish'),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFF10B981),
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: ElevatedButton.icon(
                            onPressed: _callDispatcher,
                            icon: const Icon(Icons.headset_mic, size: 20),
                            label: const Text('Dispetcher'),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFF3B82F6),
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
      bottomNavigationBar: BottomNavigationBar(
        backgroundColor: const Color(0xFF1E293B),
        selectedItemColor: const Color(0xFF38BDF8),
        unselectedItemColor: const Color(0xFF64748B),
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

  Widget _buildMetric({
    required String label,
    required String value,
    required IconData icon,
    required Color color,
  }) {
    return Column(
      children: [
        Icon(icon, color: color, size: 24),
        const SizedBox(height: 6),
        Text(
          value,
          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
        ),
      ],
    );
  }
}

