import 'package:flutter/material.dart';
import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/api_service.dart';
import '../core/background_tracker.dart';
import 'login_screen.dart';
import 'unified_profile.dart';

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

  @override
  void initState() {
    super.initState();
    _checkInitialShiftState();
    _loadProfile();
    _listenBackgroundService();
  }

  Future<void> _checkInitialShiftState() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _isShiftActive = prefs.getBool('pref_is_shift_active') ?? false;
    });
  }

  void _listenBackgroundService() {
    FlutterBackgroundService().on('GPS_UPDATE').listen((event) {
      if (event != null && mounted) {
        setState(() {
          _latitude = event['latitude'] ?? _latitude;
          _longitude = event['longitude'] ?? _longitude;
          _currentSpeed = event['speed'] ?? _currentSpeed;
          _packetsSent = event['packets'] ?? _packetsSent;
          _isServerConnected = event['connected'] ?? false;
        });
      }
    });
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
      final locationStatus = await Permission.locationAlways.request();
      if (!locationStatus.isGranted) {
        final whenInUse = await Permission.locationWhenInUse.request();
        if (!whenInUse.isGranted) {
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
      }

      // 2. Bloklanganlik tekshiruvi
      final isBlocked = _profileData?['driver']?['is_blocked'] ?? false;
      if (isBlocked) {
        if (mounted) {
          _showBlockedDialog(_profileData?['driver']?['block_reason'] ?? 'Tizim tomonidan cheklangan');
        }
        return;
      }

      final virtualGpsId = _profileData?['vehicle']?['virtual_gps_id'] ?? '9012345678';
      await BackgroundTrackerManager.startShift(virtualGpsId: virtualGpsId);
      await ApiService().logShiftStarted(virtualGpsId);

      setState(() {
        _isShiftActive = true;
      });
    } else {
      await BackgroundTrackerManager.stopShift();
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
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              tenant?['name'] ?? 'UYUSHMA TRANSPORT',
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.white),
            ),
            Text(
              driver?['full_name'] ?? 'Haydovchi',
              style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8)),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.badge_outlined, color: Color(0xFF60A5FA)),
            tooltip: 'Yagona Profil',
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const UnifiedProfileScreen()),
              );
            },
          ),
          IconButton(
            icon: const Icon(Icons.logout, color: Color(0xFF94A3B8)),
            tooltip: 'Chiqish',
            onPressed: () async {
              await ApiService().logout();
              if (mounted) {
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
                                value: _isServerConnected ? 'ON (20335)' : 'Kutilmoqda',
                                icon: Icons.wifi,
                                color: _isServerConnected ? const Color(0xFF34D399) : const Color(0xFFFBBF24),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),

                    const SizedBox(height: 16),

                    // 3. Transport Qisqacha Ma'lumoti
                    Container(
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

