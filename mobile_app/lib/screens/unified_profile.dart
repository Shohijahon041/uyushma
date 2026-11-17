import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/api_service.dart';
import 'waybill_modal.dart';

class UnifiedProfileScreen extends StatefulWidget {
  final Map<String, dynamic>? initialProfile;
  const UnifiedProfileScreen({super.key, this.initialProfile});

  @override
  State<UnifiedProfileScreen> createState() => _UnifiedProfileScreenState();
}

class _UnifiedProfileScreenState extends State<UnifiedProfileScreen> {
  bool _isLoading = true;
  Map<String, dynamic>? _profile;

  @override
  void initState() {
    super.initState();
    if (widget.initialProfile != null) {
      _profile = widget.initialProfile;
      _isLoading = false;
    }
    _fetchProfile();
  }

  Future<void> _fetchProfile() async {
    try {
      final data = await ApiService().getUnifiedProfile();
      if (mounted) {
        setState(() {
          _profile = data;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted && _profile == null) {
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
    final inspections = _profile?['inspections'];

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
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white, size: 18),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Haydovchi Profili',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Colors.white, letterSpacing: 0.3),
            ),
            Text(
              'Yagona Transport & Davlat Integratsiyalari',
              style: TextStyle(fontSize: 11, color: Color(0xFF94A3B8)),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.qr_code_2_rounded, color: Color(0xFF38BDF8), size: 24),
            tooltip: 'Elektron Yo\'l Varaqasi',
            onPressed: () {
              showWaybillSheet(context, profileData: _profile);
            },
          ),
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: Color(0xFF94A3B8), size: 22),
            tooltip: 'Yangilash',
            onPressed: _fetchProfile,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF38BDF8)))
          : RefreshIndicator(
              onRefresh: _fetchProfile,
              color: const Color(0xFF38BDF8),
              backgroundColor: const Color(0xFF0B1120),
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 14.0),
                physics: const AlwaysScrollableScrollPhysics(),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    // 1. Raqamli Haydovchilik Guvohnomasi / ID Karta (Digital ID Card)
                    _buildDigitalDriverBadge(driver, vehicle),

                    const SizedBox(height: 16),

                    // 2. Haqiqiy Egasi va Amaldagi Haydovchi Huquqiy Holati
                    _buildLegalStatusCard(vehicle, driver),

                    const SizedBox(height: 16),

                    // 3. Davlat Portallari Integratsiyalari (4 ta asosiy davlat xizmati)
                    _buildStateIntegrationsSection(integrations),

                    const SizedBox(height: 16),

                    // 3.5. Elektron Yo'l Varaqasi Maxsus Karta
                    InkWell(
                      onTap: () => showWaybillSheet(context, profileData: _profile),
                      borderRadius: BorderRadius.circular(16),
                      child: Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          gradient: const LinearGradient(
                            colors: [Color(0xFF0C1D30), Color(0xFF0B1120)],
                            begin: Alignment.topLeft,
                            end: Alignment.bottomRight,
                          ),
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: const Color(0xFF0284C7).withValues(alpha: 0.4)),
                        ),
                        child: Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(10),
                              decoration: BoxDecoration(
                                color: const Color(0xFF0284C7).withValues(alpha: 0.15),
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(color: const Color(0xFF38BDF8).withValues(alpha: 0.5)),
                              ),
                              child: const Icon(Icons.qr_code_2_rounded, color: Color(0xFF38BDF8), size: 26),
                            ),
                            const SizedBox(width: 12),
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
                                          fontWeight: FontWeight.w800,
                                          fontSize: 12,
                                          letterSpacing: 0.5,
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
                                  const SizedBox(height: 3),
                                  Text(
                                    '№ ${_profile?['waybill']?['number'] ?? 'YV-26-86964'} • QR tekshiruv',
                                    style: const TextStyle(color: Color(0xFF38BDF8), fontSize: 11, fontWeight: FontWeight.w600),
                                  ),
                                ],
                              ),
                            ),
                            const Icon(Icons.arrow_forward_ios_rounded, color: Color(0xFF475569), size: 14),
                          ],
                        ),
                      ),
                    ),

                    const SizedBox(height: 16),

                    // 4. Kunlik Tibbiy va Texnik Ko'rik (Putyovka shtamplari)
                    _buildInspectionsCard(inspections),

                    const SizedBox(height: 16),

                    // 5. Moliya, Oylik A'zolik Badali va Balans
                    _buildFinancialCard(financial, vehicle?['plate_number']),

                    const SizedBox(height: 20),

                    // 6. QR Kod ko'rsatish tugmasi
                    ElevatedButton.icon(
                      onPressed: () {
                        showWaybillSheet(context, profileData: _profile);
                      },
                      icon: const Icon(Icons.qr_code_2, color: Colors.white, size: 22),
                      label: const Text(
                        'Elektron Yo\'l Varaqasi va QR-kod',
                        style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
                      ),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF0284C7),
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      ),
                    ),

                    const SizedBox(height: 28),
                  ],
                ),
              ),
            ),
    );
  }

  // 1. Digital Driver ID Badge
  Widget _buildDigitalDriverBadge(Map<String, dynamic>? driver, Map<String, dynamic>? vehicle) {
    final fullName = driver?['full_name'] ?? 'Jamshid Karimov';
    final phone = driver?['phone'] ?? '+998 90 111-22-33';
    final pinfl = driver?['pinfl'] ?? '30101851234567';
    final licenseNumber = driver?['license_number'] ?? 'AF 7890123';
    final licenseCategories = driver?['license_categories'] ?? 'B, BC';
    final plateNumber = vehicle?['plate_number'] ?? '01A777AA';
    final model = vehicle?['model'] ?? 'Chevrolet Cobalt';
    final virtualGpsId = vehicle?['virtual_gps_id'] ?? '9012345678';

    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: const LinearGradient(
          colors: [Color(0xFF0F1E36), Color(0xFF0B1120)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        border: Border.all(color: const Color(0xFF38BDF8).withValues(alpha: 0.3), width: 1.2),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF0284C7).withValues(alpha: 0.15),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header Bar: Republic / Association Badge
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.25),
              borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Row(
                  children: [
                    Icon(Icons.shield, color: Color(0xFF38BDF8), size: 16),
                    SizedBox(width: 6),
                    Text(
                      'O\'ZBEKISTON RESPUBLIKASI',
                      style: TextStyle(
                        color: Color(0xFFE2E8F0),
                        fontSize: 10,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.8,
                      ),
                    ),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: const Color(0xFF10B981).withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: const Color(0xFF10B981)),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.verified, color: Color(0xFF34D399), size: 12),
                      SizedBox(width: 4),
                      Text(
                        'TASDIQLANGAN',
                        style: TextStyle(color: Color(0xFF34D399), fontSize: 9, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              children: [
                // Driver Avatar and Core Info
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    // Avatar Circle with Ring
                    Container(
                      width: 66,
                      height: 66,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(color: const Color(0xFF38BDF8), width: 2.5),
                        boxShadow: [
                          BoxShadow(
                            color: const Color(0xFF38BDF8).withValues(alpha: 0.35),
                            blurRadius: 14,
                            offset: const Offset(0, 4),
                          ),
                        ],
                      ),
                      child: ClipOval(
                        child: (driver?['photo_url'] != null && driver!['photo_url'].toString().isNotEmpty)
                            ? Image.network(
                                driver['photo_url'].toString(),
                                width: 66,
                                height: 66,
                                fit: BoxFit.cover,
                                errorBuilder: (_, __, ___) => _buildFallbackAvatar(fullName, 66),
                                loadingBuilder: (ctx, child, progress) {
                                  if (progress == null) return child;
                                  return _buildFallbackAvatar(fullName, 66);
                                },
                              )
                            : _buildFallbackAvatar(fullName, 66),
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            fullName,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 17,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            phone,
                            style: const TextStyle(color: Color(0xFF93C5FD), fontSize: 13, fontWeight: FontWeight.w500),
                          ),
                          const SizedBox(height: 4),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                            decoration: BoxDecoration(
                              color: const Color(0xFF1E293B),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              'Guvohnoma: $licenseNumber ($licenseCategories)',
                              style: const TextStyle(color: Color(0xFFF1F5F9), fontSize: 11, fontWeight: FontWeight.w600),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 14),
                const Divider(color: Color(0xFF334155), height: 1),
                const SizedBox(height: 12),

                // Sub Info: PINFL & Passport
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('JShShIR (PINFL)', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 10)),
                        Text(
                          pinfl,
                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 12),
                        ),
                      ],
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        const Text('Virtual GPS ID (H02)', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 10)),
                        Text(
                          virtualGpsId,
                          style: const TextStyle(color: Color(0xFF38BDF8), fontWeight: FontWeight.w800, fontSize: 13),
                        ),
                      ],
                    ),
                  ],
                ),

                const SizedBox(height: 14),

                // Vehicle Plate & Model Bar
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  decoration: BoxDecoration(
                    color: const Color(0xFF0F172A).withValues(alpha: 0.7),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFF334155)),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      // Uzbek License Plate Representation
                      _buildUzbekPlate(plateNumber),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            model,
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13),
                          ),
                          const Text(
                            'Faol Yo\'nalishda',
                            style: TextStyle(color: Color(0xFF34D399), fontSize: 11),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // Uzbek License Plate Widget
  Widget _buildUzbekPlate(String plate) {
    String region = '01';
    String rest = plate;
    if (plate.length >= 2 && int.tryParse(plate.substring(0, 2)) != null) {
      region = plate.substring(0, 2);
      rest = plate.substring(2);
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: Colors.black, width: 1.5),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
            decoration: BoxDecoration(
              color: const Color(0xFF0284C7),
              borderRadius: BorderRadius.circular(3),
            ),
            child: Text(
              region,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w900,
                fontSize: 12,
              ),
            ),
          ),
          const SizedBox(width: 6),
          Text(
            rest.toUpperCase(),
            style: const TextStyle(
              color: Colors.black,
              fontWeight: FontWeight.w900,
              fontSize: 13,
              letterSpacing: 1.2,
              fontFamily: 'monospace',
            ),
          ),
          const SizedBox(width: 6),
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 14,
                height: 3,
                color: const Color(0xFF0099B5),
              ),
              Container(
                width: 14,
                height: 3,
                color: Colors.white,
              ),
              Container(
                width: 14,
                height: 3,
                color: const Color(0xFF1EB53A),
              ),
            ],
          ),
        ],
      ),
    );
  }

  // 2. Legal Status & Ownership Card
  Widget _buildLegalStatusCard(Map<String, dynamic>? vehicle, Map<String, dynamic>? driver) {
    final realOwner = vehicle?['real_owner'];
    final ownerName = realOwner?['name'] ?? 'Toshmatov Botir Ergashevich';
    final ownerPinfl = realOwner?['pinfl'] ?? '30101851234567';
    final driverName = driver?['full_name'] ?? 'Jamshid Karimov';
    final driverPhone = driver?['phone'] ?? '+998 90 111-22-33';

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF0B1120),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFF1E293B)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.gavel, color: Color(0xFFF59E0B), size: 18),
                  SizedBox(width: 8),
                  Text(
                    'Huquqiy Egasi va Boshqaruvchi',
                    style: TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: const Color(0xFFF59E0B).withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: const Text(
                  'NOTARIAL & SOLIQ',
                  style: TextStyle(color: Color(0xFFFBBF24), fontSize: 9, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
          const Divider(color: Color(0xFF334155), height: 20),
          _buildInfoRow('Texpasportdagi egasi:', ownerName, icon: Icons.person_outline),
          _buildInfoRow('Egasining JShShIR:', ownerPinfl, icon: Icons.fingerprint),
          const SizedBox(height: 6),
          const Divider(color: Color(0xFF243044), height: 12),
          const SizedBox(height: 4),
          _buildInfoRow('Amaldagi haydovchi:', driverName, icon: Icons.drive_eta, isHighlight: true),
          _buildInfoRow('Haydovchi telefoni:', driverPhone, icon: Icons.phone),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: const Color(0xFF0F172A),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: const Color(0xFF10B981).withValues(alpha: 0.4)),
            ),
            child: const Row(
              children: [
                Icon(Icons.check_circle, color: Color(0xFF10B981), size: 14),
                SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Boshqaruv huquqi ijara shartnomasi bilan to\'liq qonuniylashtirilgan.',
                    style: TextStyle(color: Color(0xFF34D399), fontSize: 11),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // 3. Davlat Portallari Integratsiyalari (4 Cards)
  Widget _buildStateIntegrationsSection(Map<String, dynamic>? integrations) {
    final rental = integrations?['rental_contract'];
    final license = integrations?['license_sheet'];
    final route = integrations?['route_lot'];
    final insurance = integrations?['insurance'];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 4.0, vertical: 4.0),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Davlat Portallari Integratsiyalari',
                style: TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold),
              ),
              Text(
                '4/4 FAOL',
                style: TextStyle(color: Color(0xFF10B981), fontSize: 11, fontWeight: FontWeight.bold),
              ),
            ],
          ),
        ),
        const SizedBox(height: 8),

        // Soliq Ijara
        _buildServiceCard(
          portal: 'ijara.soliq.uz',
          title: 'Ijara Shartnomasi',
          number: rental?['number'] ?? 'IJARA-2026-99881',
          date: rental?['date'] ?? '2026-01-10',
          validity: rental?['validity'],
          icon: Icons.account_balance,
          badgeColor: const Color(0xFF10B981),
        ),

        const SizedBox(height: 10),

        // Transport Litsenziya
        _buildServiceCard(
          portal: 'transport.uz',
          title: 'Litsenziya Varaqasi',
          number: license?['number'] ?? 'LIC-UZ-789012',
          subLabel: license?['type'] ?? 'Yo\'lovchi tashish (Taksi)',
          validity: license?['validity'],
          icon: Icons.badge,
          badgeColor: const Color(0xFF3B82F6),
        ),

        const SizedBox(height: 10),

        // e-Tender Marshrut
        _buildRouteCard(route),

        const SizedBox(height: 10),

        // E-OSAGO Sug'urta
        _buildServiceCard(
          portal: 'E-OSAGO',
          title: 'Majburiy Avtosug\'urta',
          number: insurance?['policy_number'] ?? 'POL-UZ-992144',
          subLabel: insurance?['company'] ?? 'Apex Insurance',
          validity: insurance?['validity'],
          icon: Icons.security,
          badgeColor: const Color(0xFF8B5CF6),
        ),
      ],
    );
  }

  Widget _buildServiceCard({
    required String portal,
    required String title,
    required String number,
    String? date,
    String? subLabel,
    Map<String, dynamic>? validity,
    required IconData icon,
    required Color badgeColor,
  }) {
    final status = validity?['status'] ?? 'ACTIVE';
    final int daysLeft = validity?['days_left'] ?? 45;
    final String expDate = validity?['date'] ?? '2026-12-31';

    Color statusColor = const Color(0xFF10B981);
    String statusText = 'FAOL';
    if (status == 'EXPIRED' || daysLeft < 0) {
      statusColor = const Color(0xFFEF4444);
      statusText = 'MUDDATI O\'TGAN';
    } else if (status == 'WARNING' || daysLeft <= 10) {
      statusColor = const Color(0xFFF59E0B);
      statusText = 'TUGAMOQDA';
    }

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF0B1120),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFF1E293B)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: badgeColor.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Icon(icon, color: badgeColor, size: 18),
                  ),
                  const SizedBox(width: 8),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(title, style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold)),
                      Text(portal, style: const TextStyle(color: Color(0xFF64748B), fontSize: 10)),
                    ],
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: statusColor.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: statusColor.withValues(alpha: 0.5)),
                ),
                child: Text(
                  statusText,
                  style: TextStyle(color: statusColor, fontSize: 9, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('№: $number', style: const TextStyle(color: Color(0xFFCBD5E1), fontSize: 12, fontWeight: FontWeight.w600)),
              Text(
                daysLeft >= 0 ? '$daysLeft kun qoldi' : 'Muddati o\'tgan',
                style: TextStyle(color: statusColor, fontSize: 11, fontWeight: FontWeight.bold),
              ),
            ],
          ),
          if (subLabel != null) ...[
            const SizedBox(height: 2),
            Text(subLabel, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11)),
          ],
          const SizedBox(height: 6),
          // Progress line
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: daysLeft > 0 ? (daysLeft / 365).clamp(0.05, 1.0) : 0.0,
              backgroundColor: const Color(0xFF0F172A),
              valueColor: AlwaysStoppedAnimation<Color>(statusColor),
              minHeight: 4,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Amal qilish muddati: $expDate',
            style: const TextStyle(color: Color(0xFF64748B), fontSize: 10),
          ),
        ],
      ),
    );
  }

  Widget _buildRouteCard(Map<String, dynamic>? route) {
    final number = route?['number'] ?? 'Lot № 42 - Shahar / Viloyatlararo liniya';

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF0B1120),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFF1E293B)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: const Color(0xFF06B6D4).withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(Icons.alt_route, color: Color(0xFF06B6D4), size: 18),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Biriktirilgan Yo\'nalish / Lot', style: TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 2),
                  Text('etender.uz • $number', style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11)),
                ],
              ),
            ],
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: const Color(0xFF06B6D4).withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(6),
            ),
            child: const Text('BIRIKTIRILGAN', style: TextStyle(color: Color(0xFF06B6D4), fontSize: 9, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  // 4. Daily Medical and Technical Inspection
  Widget _buildInspectionsCard(Map<String, dynamic>? inspections) {
    final medical = inspections?['medical'];
    final technical = inspections?['technical'];

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF0B1120),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFF1E293B)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  Icon(Icons.health_and_safety, color: Color(0xFF10B981), size: 18),
                  SizedBox(width: 8),
                  Text(
                    'Kunlik Tibbiy va Texnik Ko\'rik (Putyovka)',
                    style: TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
              Text(
                'BUGUNGI KUN',
                style: TextStyle(color: Color(0xFF34D399), fontSize: 10, fontWeight: FontWeight.bold),
              ),
            ],
          ),
          const Divider(color: Color(0xFF334155), height: 20),
          _buildInspectionRow(
            title: 'Tibbiy Ko\'rik (Shifokor):',
            person: medical?['doctor'] ?? 'Dr. Rahimova N.',
            status: 'Ruxsat berilgan (07:30)',
            notes: medical?['notes'] ?? 'Qon bosimi 120/80, me\'yorda',
            icon: Icons.medical_services,
          ),
          const SizedBox(height: 12),
          _buildInspectionRow(
            title: 'Texnik Ko\'rik (Mexanik):',
            person: technical?['mechanic'] ?? 'U. Saidov (Katta mexanik)',
            status: 'Soz holatda (07:45)',
            notes: technical?['notes'] ?? 'Tormoz, chiroqlar va xavfsizlik soz',
            icon: Icons.build_circle,
          ),
        ],
      ),
    );
  }

  Widget _buildInspectionRow({
    required String title,
    required String person,
    required String status,
    required String notes,
    required IconData icon,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: const Color(0xFF60A5FA), size: 18),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(title, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11)),
                  Text(status, style: const TextStyle(color: Color(0xFF34D399), fontWeight: FontWeight.bold, fontSize: 11)),
                ],
              ),
              const SizedBox(height: 2),
              Text(person, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 12)),
              Text(notes, style: const TextStyle(color: Color(0xFF64748B), fontSize: 10)),
            ],
          ),
        ),
      ],
    );
  }

  // 5. Financial & Membership Dues Card
  Widget _buildFinancialCard(Map<String, dynamic>? financial, String? plate) {
    final double balance = (financial?['balance'] ?? 0).toDouble();
    final double fee = (financial?['monthly_plan'] ?? financial?['monthly_fee'] ?? 500000).toDouble();
    final bool isBlocked = financial?['is_blocked'] ?? false;
    final String? coveredUntil = financial?['covered_until'];

    final company = _profile?['company_info'];
    final String cardNumber = company?['card_number'] ?? '8600 0423 1122 3344';
    final String cardHolder = company?['card_holder'] ?? company?['name'] ?? 'CARLUX MCHJ';
    final String cardBank = company?['card_bank'] ?? 'Agrobank';

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFF0B1120),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: isBlocked ? const Color(0xFFEF4444) : const Color(0xFF1E293B)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Row(
                children: [
                  Icon(Icons.account_balance_wallet, color: Color(0xFF10B981), size: 18),
                  SizedBox(width: 8),
                  Text(
                    'Moliya va Oylik Badal',
                    style: TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: (balance >= 0 ? const Color(0xFF10B981) : const Color(0xFFEF4444)).withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  balance >= 0 ? 'FAOL' : 'QARZDORLIK',
                  style: TextStyle(
                    color: balance >= 0 ? const Color(0xFF34D399) : const Color(0xFFF87171),
                    fontSize: 9,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
            ],
          ),
          const Divider(color: Color(0xFF1E293B), height: 20),
          _buildInfoRow('Oylik uyushma rejasi:', '${fee.toStringAsFixed(0)} so\'m', icon: Icons.calendar_month),
          if (coveredUntil != null)
            _buildInfoRow('To\'lov amal qilish muddati:', coveredUntil, icon: Icons.event_available, isHighlight: true, customColor: const Color(0xFF34D399)),
          _buildInfoRow(
            'Oxirgi kiritilgan to\'lov:',
            '${balance.toStringAsFixed(0)} so\'m',
            icon: Icons.payments,
            isHighlight: true,
            customColor: balance > 0 ? const Color(0xFF34D399) : const Color(0xFF94A3B8),
          ),
          const SizedBox(height: 14),

          // Kompaniya rasmiy hisob kartasi (Rekvizit)
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFF070B14),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: const Color(0xFF1E293B)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Tashkilot to\'lov kartasi (Click / Payme):', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 10)),
                      const SizedBox(height: 3),
                      Text(
                        cardNumber,
                        style: const TextStyle(color: Color(0xFFFACC15), fontWeight: FontWeight.bold, fontSize: 14, letterSpacing: 1.1),
                      ),
                      Text(
                        '$cardHolder • $cardBank',
                        style: const TextStyle(color: Color(0xFF64748B), fontSize: 10),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.copy, color: Color(0xFF38BDF8), size: 20),
                  tooltip: 'Karta raqamini nusxalash',
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: cardNumber.replaceAll(' ', '')));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Karta raqami nusxalandi! Click yoki Payme orqali to\'lashingiz mumkin.'),
                        backgroundColor: Color(0xFF0284C7),
                        behavior: SnackBarBehavior.floating,
                      ),
                    );
                  },
                ),
              ],
            ),
          ),
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
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  child: const Text('Payme bilan to\'lash', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: ElevatedButton(
                  onPressed: () async {
                    await ApiService().logPaymentInitiated('CLICK', fee);
                    await launchUrl(Uri.parse('https://my.click.uz'), mode: LaunchMode.externalApplication);
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF0073FF),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  child: const Text('Click bilan to\'lash', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: () async {
                HapticFeedback.lightImpact();
                final tgUri = Uri.parse('tg://resolve?domain=uyushma_saas_bot');
                final webUri = Uri.parse('https://t.me/uyushma_saas_bot');
                try {
                  final opened = await launchUrl(tgUri, mode: LaunchMode.externalNonBrowserApplication);
                  if (!opened) {
                    await launchUrl(webUri, mode: LaunchMode.externalApplication);
                  }
                } catch (_) {
                  await launchUrl(webUri, mode: LaunchMode.externalApplication);
                }
              },
              icon: const Icon(Icons.send_rounded, color: Color(0xFF38BDF8), size: 16),
              label: const Text(
                'To\'lov chekini Telegram botga yuborish',
                style: TextStyle(color: Color(0xFF38BDF8), fontSize: 12, fontWeight: FontWeight.bold),
              ),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: Color(0xFF0284C7)),
                padding: const EdgeInsets.symmetric(vertical: 10),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInfoRow(
    String label,
    String value, {
    required IconData icon,
    bool isHighlight = false,
    Color? customColor,
  }) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Icon(icon, color: const Color(0xFF64748B), size: 14),
              const SizedBox(width: 6),
              Text(label, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
            ],
          ),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: TextStyle(
                color: customColor ?? (isHighlight ? const Color(0xFF60A5FA) : const Color(0xFFE2E8F0)),
                fontSize: 12,
                fontWeight: isHighlight ? FontWeight.bold : FontWeight.w600,
              ),
            ),
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
}

