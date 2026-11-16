import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'core/api_service.dart';
import 'core/background_tracker.dart';
import 'screens/home_dashboard.dart';
import 'screens/login_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Firebase Analytics (GA4) initsializatsiyasi
  try {
    await Firebase.initializeApp();
  } catch (e) {
    debugPrint('Firebase init (dev/offline mode): $e');
  }

  // Fon GPS xizmati (Foreground Service)
  await BackgroundTrackerManager.initializeService();

  // Sessiya holatini tekshirish
  final bool loggedIn = await ApiService().isLoggedIn();

  runApp(UyushmaApp(isLoggedIn: loggedIn));
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
          background: Color(0xFF0F172A),
        ),
        fontFamily: 'Roboto',
        useMaterial3: true,
      ),
      home: isLoggedIn ? const HomeDashboardScreen() : const LoginScreen(),
    );
  }
}

