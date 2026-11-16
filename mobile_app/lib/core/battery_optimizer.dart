import 'dart:io';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Batareya Optimizatsiyasidan Cheklanmagan Rejim (Battery Optimization Whitelist)
/// Android tizimi (Xiaomi, Samsung, Vivo, Oppo va h.k.) operatsion tizimlari
/// ekran o'chganda yoki uzoq yurganda fon xizmatini o'ldirib (kill) qo'ymasligi uchun
/// haydovchidan batareya cheklovini olib tashlashni so'raydi.
class BatteryOptimizer {
  static const String _prefPromptedKey = 'pref_battery_opt_prompted';

  /// Batareya cheklovi allaqachon olib tashlanganligini tekshirish
  static Future<bool> isIgnoringBatteryOptimizations() async {
    if (!Platform.isAndroid) return true;
    try {
      final status = await Permission.ignoreBatteryOptimizations.status;
      return status.isGranted;
    } catch (_) {
      return false;
    }
  }

  /// Foydalanuvchiga tushuntirish berib, tizimdan ruxsat so'rash
  static Future<bool> requestOptimizationDisable(BuildContext context, {bool force = false}) async {
    if (!Platform.isAndroid) return true;

    final isIgnored = await isIgnoringBatteryOptimizations();
    if (isIgnored) return true;

    final prefs = await SharedPreferences.getInstance();
    final alreadyPrompted = prefs.getBool(_prefPromptedKey) ?? false;

    // Agar avval so'ralgan bo'lsa va majburiy (force) bo'lmasa, qayta bezovta qilmaymiz
    if (alreadyPrompted && !force) return false;

    if (!context.mounted) return false;

    // Tushunarli va professional dialog oynasi
    final shouldProceed = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext ctx) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1E293B),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          title: const Row(
            children: [
              Icon(Icons.battery_charging_full_rounded, color: Color(0xFF10B981), size: 28),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Uzluksiz GPS Nazorati',
                  style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
          content: const Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Telefoningiz ekrani o\'chgan vaqtda yo\'l monitoringi va dispetcher bilan aloqa to\'xtab qolmasligi uchun ilovani batareya tejamkorligi cheklovidan chiqarish zarur.',
                style: TextStyle(color: Color(0xFF94A3B8), fontSize: 14, height: 1.5),
              ),
              SizedBox(height: 12),
              Text(
                '• Smena vaqti to\'g\'ri hisoblanadi\n• GPS aloqasi uzilmaydi\n• Jarima va ogohlantirishlar xavfi bo\'lmaydi',
                style: TextStyle(color: Color(0xFF38BDF8), fontSize: 13, height: 1.6),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(false),
              child: const Text('Keyinroq', style: TextStyle(color: Color(0xFF64748B))),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF10B981),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
              ),
              onPressed: () => Navigator.of(ctx).pop(true),
              child: const Text('Ruxsat berish', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        );
      },
    );

    await prefs.setBool(_prefPromptedKey, true);

    if (shouldProceed == true) {
      final status = await Permission.ignoreBatteryOptimizations.request();
      return status.isGranted;
    }

    return false;
  }
}
