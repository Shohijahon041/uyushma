import 'dart:convert';
import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class ApiService {
  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;
  ApiService._internal();

  // API Asosiy manzili (VDS ishlab chiqarish serveri)
  static const String baseUrl = 'https://uyushma.bmbrutto.uz/api/v1';

  // Firebase Analytics (xavfsiz ixtiyoriy getter)
  FirebaseAnalytics? get _analytics {
    try {
      return FirebaseAnalytics.instance;
    } catch (_) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // FIREBASE ANALYTICS HODISALARI (GA4)
  // ---------------------------------------------------------------------------
  Future<void> logEvent(String name, [Map<String, Object>? parameters]) async {
    try {
      await _analytics?.logEvent(name: name, parameters: parameters);
    } catch (_) {}
  }

  Future<void> logLogin(String phone) async {
    await logEvent('driver_login_success', {'phone': phone});
  }

  Future<void> logShiftStarted(String virtualGpsId) async {
    await logEvent('driver_shift_started', {'virtual_gps_id': virtualGpsId});
  }

  Future<void> logPaymentInitiated(String provider, double amount) async {
    await logEvent('payment_initiated', {
      'provider': provider,
      'amount': amount,
    });
  }

  Future<void> logDispatcherCall() async {
    await logEvent('dispatcher_call_clicked');
  }

  // ---------------------------------------------------------------------------
  // AUTH (SMS / TELEGRAM OTP)
  // ---------------------------------------------------------------------------
  Future<Map<String, dynamic>> requestOtp(String phone, {String channel = 'auto'}) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/request-otp'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'phone': phone, 'channel': channel}),
    );

    final data = jsonDecode(response.body);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      await logEvent('otp_requested', {'phone': phone, 'channel': channel});
      return data;
    } else {
      throw Exception(data['detail'] ?? 'Kod so\'rashda xatolik yuz berdi');
    }
  }

  Future<Map<String, dynamic>> getTelegramInfo(String phone) async {
    try {
      final response = await http.get(
        Uri.parse('$baseUrl/auth/telegram-info?phone=${Uri.encodeComponent(phone)}'),
      ).timeout(const Duration(seconds: 4));
      if (response.statusCode == 200) {
        return jsonDecode(response.body);
      }
    } catch (_) {}
    return {
      'bot_username': 'uyushma_saas_bot',
      'bot_url': 'https://t.me/uyushma_saas_bot',
      'is_linked': false,
    };
  }


  // ---------------------------------------------------------------------------
  // AUTH (SMS / TELEGRAM OTP) - REAL PRODUCTION
  // ---------------------------------------------------------------------------
  Future<Map<String, dynamic>> verifyOtp(String phone, String code) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/verify-otp'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'phone': phone, 'code': code}),
    );

    final data = jsonDecode(response.body);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      final String token = data['token'];
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString('jwt_token', token);
      await prefs.setString('user_data', jsonEncode(data['user']));
      if (data['vehicle'] != null) {
        await prefs.setString('vehicle_data', jsonEncode(data['vehicle']));
        if (data['vehicle']['virtual_gps_id'] != null) {
          await prefs.setString('virtual_gps_id', data['vehicle']['virtual_gps_id']);
        }
      }

      await logLogin(phone);
      return data;
    } else {
      throw Exception(data['detail'] ?? 'Kodni tasdiqlashda xatolik yuz berdi');
    }
  }

  // ---------------------------------------------------------------------------
  // SMENA BOSHQARUVI (SHIFT MANAGEMENT)
  // ---------------------------------------------------------------------------
  Future<Map<String, dynamic>> startShift({required String virtualGpsId, int? odometer, String? note}) async {
    final prefs = await SharedPreferences.getInstance();
    final String? token = prefs.getString('jwt_token');

    final response = await http.post(
      Uri.parse('$baseUrl/driver/shift/start'),
      headers: {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      },
      body: jsonEncode({
        'virtual_gps_id': virtualGpsId,
        'odometer': odometer,
        'note': note,
      }),
    );

    final data = jsonDecode(response.body);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      await logShiftStarted(virtualGpsId);
      return data;
    } else {
      throw Exception(data['detail'] ?? 'Smenani ochishda xatolik yuz berdi');
    }
  }

  Future<Map<String, dynamic>> stopShift({required String virtualGpsId, int? odometer, String? note}) async {
    final prefs = await SharedPreferences.getInstance();
    final String? token = prefs.getString('jwt_token');

    final response = await http.post(
      Uri.parse('$baseUrl/driver/shift/stop'),
      headers: {
        'Content-Type': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
      },
      body: jsonEncode({
        'virtual_gps_id': virtualGpsId,
        'odometer': odometer,
        'note': note,
      }),
    );

    final data = jsonDecode(response.body);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return data;
    } else {
      throw Exception(data['detail'] ?? 'Smenani tugatishda xatolik yuz berdi');
    }
  }

  // ---------------------------------------------------------------------------
  // ELEKTRON YO'L VARAQASI (WAYBILL)
  // ---------------------------------------------------------------------------
  Future<Map<String, dynamic>> getActiveWaybill() async {
    final prefs = await SharedPreferences.getInstance();
    final String? token = prefs.getString('jwt_token');

    if (token == null) {
      throw Exception('Foydalanuvchi tizimga kirmagan');
    }

    final response = await http.get(
      Uri.parse('$baseUrl/driver/waybill'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
    );

    final data = jsonDecode(response.body);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return data;
    } else {
      throw Exception(data['detail'] ?? 'Yo\'l varaqasini yuklashda xatolik');
    }
  }

  // ---------------------------------------------------------------------------
  // YAGONA PROFIL (UNIFIED PROFILE)
  // ---------------------------------------------------------------------------
  Future<Map<String, dynamic>> getUnifiedProfile() async {
    final prefs = await SharedPreferences.getInstance();
    final String? token = prefs.getString('jwt_token');

    if (token == null) {
      throw Exception('Foydalanuvchi tizimga kirmagan');
    }

    final response = await http.get(
      Uri.parse('$baseUrl/driver/profile'),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
    );

    final data = jsonDecode(response.body);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return data;
    } else {
      throw Exception(data['detail'] ?? 'Profilni yuklashda xatolik');
    }
  }

  // ---------------------------------------------------------------------------
  // SESSIYA BOSHQARUVI
  // ---------------------------------------------------------------------------
  Future<bool> isLoggedIn() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.containsKey('jwt_token');
  }

  Future<String?> getSavedVirtualGpsId() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString('virtual_gps_id');
  }

  Future<void> logout() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.clear();
    await logEvent('driver_logout');
  }
}

