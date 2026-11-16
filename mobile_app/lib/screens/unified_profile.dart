import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/api_service.dart';

class UnifiedProfileScreen extends StatefulWidget {
  const UnifiedProfileScreen({super.key});

  @override
  State<UnifiedProfileScreen> createState() => _UnifiedProfileScreenState();
}

class _UnifiedProfileScreenState extends State<UnifiedProfileScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _profile;

  @override
  void initState() {
    super.initState();
    _fetchProfile();
  }

  Future<void> _fetchProfile() async {
    setState(() => _isLoading = true);
    try {
      final data = await ApiService().getUnifiedProfile();
      if (mounted) {
        setState(() {
          _profile = data;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final vehicle = _profile?['vehicle'];
    final driver = _profile?['driver'];
    final integrations = _profile?['integrations'];
    final financial = _profile?['financial'];

    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E293B),
        elevation: 0,
        title: const Text(
          'Yagona Haydovchi va Transport Profili',
          style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.white),
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF3B82F6)))
          : RefreshIndicator(
              onRefresh: _fetchProfile,
              color: const Color(0xFF3B82F6),
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16.0),
                physics: const AlwaysScrollableScrollPhysics(),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // Transport Sarlavhasi
                    _buildVehicleHeaderCard(vehicle),

                    const SizedBox(height: 16),

                    // Egasi va Haydovchi taqqoslovi
                    _buildOwnerAndDriverCard(vehicle, driver),

                    const SizedBox(height: 16),

                    // Davlat Portallari Integratsiyalari
                    _buildIntegrationCard(
                      title: 'Ijara Shartnomasi (ijara.soliq.uz)',
                      badgeText: integrations?['rental_contract']?['validity']?['status'] ?? 'NOMA\'LUM',
                      icon: Icons.assignment_outlined,
                      details: [
                        _buildRow('Shartnoma №:', integrations?['rental_contract']?['number'] ?? '—'),
                        _buildRow('Tuzilgan sana:', integrations?['rental_contract']?['date'] ?? '—'),
                        _buildRow(
                          'Amal qilish muddati:',
                          integrations?['rental_contract']?['validity']?['date'] ?? '—',
                          isDate: true,
                          daysLeft: integrations?['rental_contract']?['validity']?['days_left'],
                        ),
                      ],
                    ),

                    const SizedBox(height: 12),

                    _buildIntegrationCard(
                      title: 'Litsenziya Varaqasi (transport.uz)',
                      badgeText: integrations?['license_sheet']?['validity']?['status'] ?? 'NOMA\'LUM',
                      icon: Icons.badge_outlined,
                      details: [
                        _buildRow('Varaqa №:', integrations?['license_sheet']?['number'] ?? '—'),
                        _buildRow('Faoliyat turi:', integrations?['license_sheet']?['type'] ?? '—'),
                        _buildRow(
                          'Amal qilish muddati:',
                          integrations?['license_sheet']?['validity']?['date'] ?? '—',
                          isDate: true,
                          daysLeft: integrations?['license_sheet']?['validity']?['days_left'],
                        ),
                      ],
                    ),

                    const SizedBox(height: 12),

                    _buildIntegrationCard(
                      title: 'Biriktirilgan Yo\'nalish / Lot (etender.uz)',
                      badgeText: 'BIRIKTIRILGAN',
                      icon: Icons.alt_route,
                      details: [
                        _buildRow('Lot / Marshrut:', integrations?['route_lot']?['number'] ?? 'Biriktirilmagan'),
                      ],
                    ),

                    const SizedBox(height: 12),

                    _buildIntegrationCard(
                      title: 'Majburiy Avtosug\'urta (E-OSAGO)',
                      badgeText: integrations?['insurance']?['validity']?['status'] ?? 'NOMA\'LUM',
                      icon: Icons.security,
                      details: [
                        _buildRow('Polis №:', integrations?['insurance']?['policy_number'] ?? '—'),
                        _buildRow('Sug\'urta kompaniyasi:', integrations?['insurance']?['company'] ?? '—'),
                        _buildRow(
                          'Amal qilish muddati:',
                          integrations?['insurance']?['validity']?['date'] ?? '—',
                          isDate: true,
                          daysLeft: integrations?['insurance']?['validity']?['days_left'],
                        ),
                      ],
                    ),

                    const SizedBox(height: 16),

                    // Moliya va Balans
                    _buildFinancialCard(financial, vehicle?['plate_number']),

                    const SizedBox(height: 24),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildVehicleHeaderCard(Map<String, dynamic>? vehicle) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFF334155)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                vehicle?['plate_number'] ?? '01A777AA',
                style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: Colors.white, letterSpacing: 1),
              ),
              const SizedBox(height: 4),
              Text(
                vehicle?['model'] ?? 'Chevrolet Cobalt',
                style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
              ),
            ],
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              const Text('Virtual GPS ID (H02)', style: TextStyle(color: Color(0xFF64748B), fontSize: 11)),
              Text(
                vehicle?['virtual_gps_id'] ?? '9012345678',
                style: const TextStyle(color: Color(0xFF38BDF8), fontWeight: FontWeight.w900, fontSize: 16),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildOwnerAndDriverCard(Map<String, dynamic>? vehicle, Map<String, dynamic>? driver) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFF334155)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Haqiqiy Egasi va Amaldagi Haydovchi',
            style: TextStyle(color: Color(0xFFCBD5E1), fontSize: 14, fontWeight: FontWeight.bold),
          ),
          const Divider(color: Color(0xFF334155), height: 20),
          _buildRow('Texpasport bo\'yicha egasi:', vehicle?['real_owner']?['name'] ?? '—'),
          _buildRow('Egasining JShShIR (PINFL):', vehicle?['real_owner']?['pinfl'] ?? '—'),
          const SizedBox(height: 8),
          _buildRow('Hozirgi haydayotgan shaxs:', driver?['full_name'] ?? '—', isHighlight: true),
          _buildRow('Haydovchi telefoni:', driver?['phone'] ?? '—'),
        ],
      ),
    );
  }

  Widget _buildIntegrationCard({
    required String title,
    required String badgeText,
    required IconData icon,
    required List<Widget> details,
  }) {
    Color badgeColor = const Color(0xFF10B981);
    if (badgeText == 'EXPIRED' || badgeText == 'Muddati o\'tgan') {
      badgeColor = const Color(0xFFEF4444);
    } else if (badgeText == 'WARNING' || badgeText == 'Ogohlantirish') {
      badgeColor = const Color(0xFFF59E0B);
    }

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFF334155)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Icon(icon, color: const Color(0xFF60A5FA), size: 20),
                  const SizedBox(width: 8),
                  Text(
                    title,
                    style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: badgeColor.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: badgeColor.withOpacity(0.4)),
                ),
                child: Text(
                  badgeText,
                  style: TextStyle(color: badgeColor, fontSize: 10, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
          const Divider(color: Color(0xFF334155), height: 20),
          ...details,
        ],
      ),
    );
  }

  Widget _buildFinancialCard(Map<String, dynamic>? financial, String? plate) {
    final double balance = (financial?['balance'] ?? 0).toDouble();
    final double fee = (financial?['monthly_fee'] ?? 0).toDouble();
    final bool isBlocked = financial?['is_blocked'] ?? false;

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFF1E293B),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: isBlocked ? const Color(0xFFEF4444) : const Color(0xFF334155)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Moliya va Oylik Badal',
            style: TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold),
          ),
          const Divider(color: Color(0xFF334155), height: 20),
          _buildRow('Oylik uyushma badali:', '${fee.toStringAsFixed(0)} so\'m'),
          _buildRow(
            'Joriy hisob balansi:',
            '${balance.toStringAsFixed(0)} so\'m',
            isHighlight: true,
            customColor: balance < 0 ? const Color(0xFFEF4444) : const Color(0xFF10B981),
          ),
          if (financial?['block_reason'] != null) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: const Color(0xFF450A0A),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                'Sabab: ${financial?['block_reason']}',
                style: const TextStyle(color: Color(0xFFFCA5A5), fontSize: 11),
              ),
            ),
          ],
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: ElevatedButton(
                  onPressed: () async {
                    await ApiService().logPaymentInitiated('PAYME', fee);
                    await launchUrl(Uri.parse('https://checkout.paycom.uz'), mode: LaunchMode.externalApplication);
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF00CCCC),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  child: const Text('Payme', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton(
                  onPressed: () async {
                    await ApiService().logPaymentInitiated('CLICK', fee);
                    await launchUrl(Uri.parse('https://my.click.uz'), mode: LaunchMode.externalApplication);
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0073FF),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  child: const Text('Click', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildRow(
    String label,
    String value, {
    bool isHighlight = false,
    bool isDate = false,
    int? daysLeft,
    Color? customColor,
  }) {
    String suffix = '';
    if (isDate && daysLeft != null) {
      if (daysLeft < 0) {
        suffix = ' (Muddati o\'tgan)';
      } else {
        suffix = ' ($daysLeft kun qoldi)';
      }
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
          Flexible(
            child: Text(
              '$value$suffix',
              textAlign: TextAlign.end,
              style: TextStyle(
                color: customColor ?? (isHighlight ? const Color(0xFF60A5FA) : const Color(0xFFE2E8F0)),
                fontSize: 12,
                fontWeight: isHighlight ? FontWeight.bold : FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

