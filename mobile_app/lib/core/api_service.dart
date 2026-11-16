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

  final FirebaseAnalytics _analytics = FirebaseAnalytics.instance;

  // ---------------------------------------------------------------------------
  // FIREBASE ANALYTICS HODISALARI (GA4)
  // ---------------------------------------------------------------------------
  Future<void> logEvent(String name, [Map<String, Object>? parameters]) async {
    try {
      await _analytics.logEvent(name: name, parameters: parameters);
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
  // AUTH (SMS OTP ESKIZ.UZ)
  // ---------------------------------------------------------------------------
  Future<Map<String, dynamic>> requestOtp(String phone) async {
    final response = await http.post(
      Uri.parse('$baseUrl/auth/request-otp'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'phone': phone}),
    );

    final data = jsonDecode(response.body);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      await logEvent('otp_requested', {'phone': phone});
      return data;
    } else {
      throw Exception(data['detail'] ?? 'SMS kod so\'rashda xatolik yuz berdi');
    }
  }

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

