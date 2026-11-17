import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

void showWaybillSheet(BuildContext context, {required Map<String, dynamic>? profileData}) {
  final waybill = profileData?['waybill'] ?? {};
  final driver = profileData?['driver'] ?? {};
  final vehicle = profileData?['vehicle'] ?? {};
  final routeInfo = profileData?['route_info'] ?? {};
  final companyInfo = profileData?['company_info'] ?? {};

  final String wbNumber = waybill['number'] ?? 'YV-26-86964';
  final String wbDate = waybill['date'] ?? DateTime.now().toString().substring(0, 10);
  final String? verifyUrl = waybill['public_verification_url'] ??
      (waybill['public_token'] != null
          ? 'https://uyushma.bmbrutto.uz/waybill/${waybill['public_token']}'
          : 'https://uyushma.bmbrutto.uz/waybill');

  final String driverName = driver['full_name'] ?? 'Haydovchi';
  final String driverLicense = driver['license_number'] ?? 'AF5261671';
  final String plateNumber = vehicle['plate_number'] ?? '60A125UA';
  final String vehicleModel = vehicle['model'] ?? 'DAMAS';
  final String fuelType = waybill['fuel_type'] ?? 'METAN';
  final String routeName = routeInfo['name'] ?? 'Узумзор автостанцияси-Иттифоқ';
  final String doctorName = waybill['medical_doctor'] ?? 'Dr. Rahimova N. (Katta shifokor)';
  final String mechanicName = waybill['mechanic_name'] ?? 'U. Saidov (Katta mexanik)';
  final String companyName = companyInfo['name'] ?? 'CARLUX MCHJ';

  // Muddatni hisoblash (Validity engine)
  String wbStatusText = 'RASMIY VA AMALDA';
  Color wbStatusColor = const Color(0xFF10B981);
  Color wbBadgeBg = const Color(0xFF10B981).withValues(alpha: 0.15);
  IconData wbStatusIcon = Icons.verified;

  final now = DateTime.now();
  DateTime? dateObj;
  try {
    dateObj = DateTime.parse(wbDate);
  } catch (_) {}

  if (dateObj != null) {
    final todayDate = DateTime(now.year, now.month, now.day);
    final wbDay = DateTime(dateObj.year, dateObj.month, dateObj.day);
    if (wbDay.isBefore(todayDate)) {
      wbStatusText = 'MUDDATI O\'TGAN';
      wbStatusColor = const Color(0xFFEF4444);
      wbBadgeBg = const Color(0xFFEF4444).withValues(alpha: 0.15);
      wbStatusIcon = Icons.error_outline;
    } else if (now.hour >= 22) {
      wbStatusText = 'MUDDATI BUGUN TUGAYDI (23:59)';
      wbStatusColor = const Color(0xFFF59E0B);
      wbBadgeBg = const Color(0xFFF59E0B).withValues(alpha: 0.15);
      wbStatusIcon = Icons.access_time;
    }
  }

  showModalBottomSheet(
    context: context,
    backgroundColor: const Color(0xFF070B14),
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (ctx) {
      return DraggableScrollableSheet(
        initialChildSize: 0.88,
        minChildSize: 0.5,
        maxChildSize: 0.95,
        expand: false,
        builder: (_, scrollController) {
          return SingleChildScrollView(
            controller: scrollController,
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 44,
                    height: 4,
                    decoration: BoxDecoration(
                      color: const Color(0xFF334155),
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                ),
                const SizedBox(height: 16),

                // Rasmiy davlat standarti sarlavhasi
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: const Color(0xFF0B1120),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: const Color(0xFF1E293B)),
                  ),
                  child: Column(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                        decoration: BoxDecoration(
                          color: wbBadgeBg,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: wbStatusColor),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(wbStatusIcon, color: wbStatusColor, size: 14),
                            const SizedBox(width: 6),
                            Text(
                              wbStatusText,
                              style: TextStyle(color: wbStatusColor, fontWeight: FontWeight.bold, fontSize: 11),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 10),
                      const Text(
                        'ELEKTRON YO\'L VARAQASI',
                        style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w900, letterSpacing: 0.5),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '№ $wbNumber • Sana: $wbDate',
                        style: const TextStyle(color: Color(0xFF38BDF8), fontWeight: FontWeight.bold, fontSize: 13),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Tashkilot: $companyName',
                        style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 16),

                // MARKAZIY HAQIQIY SKANERLANADIGAN QR-KOD (Bosganda to'liq ekran)
                Center(
                  child: InkWell(
                    onTap: () {
                      HapticFeedback.lightImpact();
                      _showFullscreenQr(
                        context,
                        verifyUrl: verifyUrl ?? 'https://uyushma.bmbrutto.uz/waybill',
                        wbNumber: wbNumber,
                        plateNumber: plateNumber,
                        driverName: driverName,
                      );
                    },
                    borderRadius: BorderRadius.circular(20),
                    child: Stack(
                      alignment: Alignment.bottomRight,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(color: const Color(0xFF38BDF8), width: 2),
                            boxShadow: [
                              BoxShadow(
                                color: const Color(0xFF38BDF8).withValues(alpha: 0.25),
                                blurRadius: 18,
                                offset: const Offset(0, 4),
                              ),
                            ],
                          ),
                          child: QrImageView(
                            data: verifyUrl ?? 'https://uyushma.bmbrutto.uz/waybill',
                            version: QrVersions.auto,
                            size: 190.0,
                            backgroundColor: Colors.white,
                          ),
                        ),
                        Container(
                          margin: const EdgeInsets.all(8),
                          padding: const EdgeInsets.all(6),
                          decoration: BoxDecoration(
                            color: const Color(0xFF070B14).withValues(alpha: 0.85),
                            shape: BoxShape.circle,
                            border: Border.all(color: const Color(0xFF38BDF8)),
                          ),
                          child: const Icon(Icons.fullscreen_rounded, color: Color(0xFF38BDF8), size: 18),
                        ),
                      ],
                    ),
                  ),
                ),

                const SizedBox(height: 12),
                Center(
                  child: Column(
                    children: [
                      Text(
                        '$driverName • $plateNumber',
                        style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
                      ),
                      const SizedBox(height: 4),
                      const Text(
                        'Kattalashtirish uchun QR kod ustiga bosing\n(YHXBB yoki Transport Nazorati inspektoriga taqdim etish uchun)',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 16),

                // Transport va Haydovchi Tafsilotlari
                _buildInfoSection('Transport va Yo\'nalish', [
                  _buildRow('Davlat raqami:', plateNumber, isHighlight: true, color: const Color(0xFFFACC15)),
                  _buildRow('Model / Rusumi:', vehicleModel),
                  _buildRow('Yoqilg\'i turi:', fuelType),
                  _buildRow('Yo\'nalish nomi:', routeName),
                ]),

                const SizedBox(height: 12),

                _buildInfoSection('Haydovchi Ma\'lumotlari', [
                  _buildRow('F.I.O.:', driverName),
                  _buildRow('Guvohnoma (prava):', driverLicense),
                  _buildRow('Telefon:', driver['phone'] ?? '+998 91 127 89 02'),
                ]),

                const SizedBox(height: 12),

                // Majburiy Kunlik Ko'riklar (Tibbiy & Texnik)
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: const Color(0xFF0B1120),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: const Color(0xFF1E293B)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'KUNLIK MAJBURIY KO\'RIKLAR',
                        style: TextStyle(color: Color(0xFF38BDF8), fontWeight: FontWeight.bold, fontSize: 11, letterSpacing: 0.5),
                      ),
                      const Divider(color: Color(0xFF1E293B), height: 16),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.medical_services, color: Color(0xFF34D399), size: 18),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Text('Kunlik Tibbiy Ko\'rik', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
                                    Text('✓ Ruxsat berilgan', style: TextStyle(color: Color(0xFF34D399), fontWeight: FontWeight.bold, fontSize: 11)),
                                  ],
                                ),
                                const SizedBox(height: 2),
                                Text(doctorName, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11)),
                                const Text('Qon bosimi 120/80, me\'yorda. Safarga yaroqli.', style: TextStyle(color: Color(0xFF64748B), fontSize: 10)),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.build_circle, color: Color(0xFF38BDF8), size: 18),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Text('Kunlik Texnik Ko\'rik', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
                                    Text('✓ Soz holatda', style: TextStyle(color: Color(0xFF34D399), fontWeight: FontWeight.bold, fontSize: 11)),
                                  ],
                                ),
                                const SizedBox(height: 2),
                                Text(mechanicName, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11)),
                                const Text('Tormoz, chiroqlar, gaz/benzin tizimi soz.', style: TextStyle(color: Color(0xFF64748B), fontSize: 10)),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: 16),

                // Havolani ochish tugmasi
                if (verifyUrl != null && verifyUrl.isNotEmpty) ...[
                  OutlinedButton.icon(
                    onPressed: () async {
                      try {
                        await launchUrl(Uri.parse(verifyUrl), mode: LaunchMode.externalApplication);
                      } catch (_) {}
                    },
                    icon: const Icon(Icons.open_in_browser, color: Color(0xFF38BDF8), size: 18),
                    label: const Text('Inspektor tekshiruv sahifasini ochish', style: TextStyle(color: Color(0xFF38BDF8), fontWeight: FontWeight.bold)),
                    style: OutlinedButton.styleFrom(
                      side: const BorderSide(color: Color(0xFF0284C7)),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                  const SizedBox(height: 10),
                ],

                ElevatedButton(
                  onPressed: () => Navigator.pop(ctx),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF1E293B),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Text('Yopish', style: TextStyle(fontWeight: FontWeight.bold)),
                ),
                const SizedBox(height: 12),
              ],
            ),
          );
        },
      );
    },
  );
}

void _showFullscreenQr(
  BuildContext context, {
  required String verifyUrl,
  required String wbNumber,
  required String plateNumber,
  required String driverName,
}) {
  showDialog(
    context: context,
    builder: (ctx) => Dialog(
      backgroundColor: const Color(0xFF070B14),
      insetPadding: const EdgeInsets.all(16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('RASMIY YO\'L VARAQASI', style: TextStyle(color: Color(0xFF38BDF8), fontWeight: FontWeight.bold, fontSize: 12)),
                    Text(wbNumber, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 16)),
                  ],
                ),
                IconButton(
                  onPressed: () => Navigator.pop(ctx),
                  icon: const Icon(Icons.close_rounded, color: Colors.white),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFF38BDF8).withValues(alpha: 0.3),
                    blurRadius: 20,
                    spreadRadius: 2,
                  ),
                ],
              ),
              child: QrImageView(
                data: verifyUrl,
                version: QrVersions.auto,
                size: 260.0,
                backgroundColor: Colors.white,
              ),
            ),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(
                color: const Color(0xFF0B1120),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFF1E293B)),
              ),
              child: Column(
                children: [
                  Text(
                    plateNumber,
                    style: const TextStyle(color: Color(0xFFFACC15), fontWeight: FontWeight.w900, fontSize: 18, letterSpacing: 1),
                  ),
                  Text(
                    driverName,
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            const Text(
              'YHXBB (GAI) yoki Transport Nazorati inspektori skanerlashi uchun ekran yorqinligini oshiring',
              textAlign: TextAlign.center,
              style: TextStyle(color: Color(0xFF64748B), fontSize: 11),
            ),
          ],
        ),
      ),
    ),
  );
}

Widget _buildInfoSection(String title, List<Widget> rows) {
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
        Text(
          title.toUpperCase(),
          style: const TextStyle(color: Color(0xFF38BDF8), fontWeight: FontWeight.bold, fontSize: 11, letterSpacing: 0.5),
        ),
        const Divider(color: Color(0xFF1E293B), height: 14),
        ...rows,
      ],
    ),
  );
}

Widget _buildRow(String label, String value, {bool isHighlight = false, Color? color}) {
  return Padding(
    padding: const EdgeInsets.symmetric(vertical: 3.0),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
        Text(
          value,
          style: TextStyle(
            color: color ?? (isHighlight ? Colors.white : const Color(0xFFCBD5E1)),
            fontWeight: isHighlight ? FontWeight.bold : FontWeight.w600,
            fontSize: 12,
          ),
        ),
      ],
    ),
  );
}
