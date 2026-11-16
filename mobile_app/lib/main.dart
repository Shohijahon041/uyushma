import 'dart:async';
import 'package:flutter/material.dart';
import 'core/api_service.dart';
import 'core/background_tracker.dart';
import 'screens/home_dashboard.dart';
import 'screens/login_screen.dart';

void main() async {
  runZonedGuarded(() async {
    WidgetsFlutterBinding.ensureInitialized();

    // Global xatoliklarni ushlab qolish (ilova yopilib ketmasligi uchun)
    FlutterError.onError = (FlutterErrorDetails details) {
      FlutterError.presentError(details);
      debugPrint('[FLUTTER-ERROR] ${details.exception}');
    };

    // Fon GPS xizmati initsializatsiyasi
    try {
      await BackgroundTrackerManager.initializeService();
    } catch (e) {
      debugPrint('[SERVICE-INIT-ERROR] $e');
    }

    // Sessiya holatini tekshirish
    bool loggedIn = false;
    try {
      loggedIn = await ApiService().isLoggedIn();
    } catch (e) {
      debugPrint('[SESSION-CHECK-ERROR] $e');
    }

    runApp(UyushmaApp(isLoggedIn: loggedIn));
  }, (error, stack) {
    debugPrint('[GLOBAL-UNCAUGHT-ERROR] $error');
  });
}

class UyushmaApp extends StatelessWidget {
  final bool isLoggedIn;
  const UyushmaApp({super.key, required this.isLoggedIn});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Uyushma GPS & Fleet',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: const Color(0xFF0F172A),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF2563EB),
          secondary: Color(0xFF10B981),
          surface: Color(0xFF1E293B),
        ),
        fontFamily: 'Roboto',
        useMaterial3: true,
      ),
      home: isLoggedIn ? const HomeDashboardScreen() : const LoginScreen(),
    );
  }
}
