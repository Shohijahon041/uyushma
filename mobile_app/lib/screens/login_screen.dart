import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/api_service.dart';
import 'home_dashboard.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final TextEditingController _phoneController = TextEditingController(text: '+998 ');
  final TextEditingController _otpController = TextEditingController();

  bool _isCodeSent = false;
  bool _isLoading = false;
  String? _errorMessage;

  String _selectedChannel = 'telegram'; // 'telegram' yoki 'sms'
  String _sentChannel = 'telegram';
  String _botUsername = 'uyushma_saas_bot';
  String _botUrl = 'https://t.me/uyushma_saas_bot';

  int _resendCountdown = 120;
  Timer? _countdownTimer;

  @override
  void initState() {
    super.initState();
    _fetchBotInfo();
  }

  @override
  void dispose() {
    _phoneController.dispose();
    _otpController.dispose();
    _countdownTimer?.cancel();
    super.dispose();
  }

  Future<void> _fetchBotInfo() async {
    try {
      final info = await ApiService().getTelegramInfo('');
      if (mounted) {
        setState(() {
          _botUsername = info['bot_username'] ?? _botUsername;
          _botUrl = info['bot_url'] ?? _botUrl;
        });
      }
    } catch (_) {}
  }

  void _startCountdown() {
    setState(() {
      _resendCountdown = 120;
    });
    _countdownTimer?.cancel();
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (_resendCountdown > 0) {
        setState(() {
          _resendCountdown--;
        });
      } else {
        timer.cancel();
      }
    });
  }

  String _cleanPhone(String input) {
    return input.replaceAll(RegExp(r'\s+'), '');
  }

  Future<void> _openTelegramBot() async {
    final cleanPhone = _cleanPhone(_phoneController.text).replaceAll(RegExp(r'\D'), '');
    final botName = _botUsername.isNotEmpty ? _botUsername : 'uyushma_saas_bot';

    final tgDirectUri = Uri.parse('tg://resolve?domain=$botName&start=otp_$cleanPhone');
    final webUri = Uri.parse('https://t.me/$botName?start=otp_$cleanPhone');

    bool opened = false;
    try {
      opened = await launchUrl(tgDirectUri, mode: LaunchMode.externalNonBrowserApplication);
    } catch (_) {}

    if (!opened) {
      try {
        opened = await launchUrl(tgDirectUri, mode: LaunchMode.externalApplication);
      } catch (_) {}
    }

    if (!opened) {
      try {
        opened = await launchUrl(webUri, mode: LaunchMode.externalNonBrowserApplication);
      } catch (_) {}
    }

    if (!opened) {
      try {
        opened = await launchUrl(webUri, mode: LaunchMode.externalApplication);
      } catch (_) {}
    }

    if (!opened) {
      try {
        opened = await launchUrl(webUri, mode: LaunchMode.platformDefault);
      } catch (_) {}
    }

    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text("Telegram bot: @$botName"),
          backgroundColor: const Color(0xFF0284C7),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  Future<void> _handleRequestOtp({String? forcedChannel}) async {
    final phone = _cleanPhone(_phoneController.text);
    if (phone.length < 13) {
      setState(() {
        _errorMessage = "Telefon raqamni to'liq kiriting (+998 XX XXX XX XX)";
      });
      return;
    }

    final channelToUse = forcedChannel ?? _selectedChannel;

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final res = await ApiService().requestOtp(phone, channel: channelToUse);
      final isTelegramLinked = res['telegram_linked'] == true;
      setState(() {
        _isCodeSent = true;
        _isLoading = false;
        _sentChannel = res['channel'] ?? channelToUse;
        _botUsername = res['bot_username'] ?? _botUsername;
        _botUrl = res['bot_url'] ?? _botUrl;
        _otpController.clear();
      });
      _startCountdown();

      // Faqatgina agar hisob hali Telegram botga ulanmagan bo'lsa (birinchi marta),
      // botni avtomatik ochib START bosdiramiz.
      // Agar allaqachon ulangan bo'lsa, kod to'g'ridan-to'g'ri Telegram bildirishnomasi bo'lib keladi.
      if (!isTelegramLinked && channelToUse == 'telegram') {
        _openTelegramBot();
      } else if (isTelegramLinked && channelToUse == 'telegram' && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text("5 xonali kod Telegram botingizga (@$_botUsername) yuborildi!"),
            backgroundColor: const Color(0xFF0284C7),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } catch (e) {
      setState(() {
        _errorMessage = e.toString().replaceAll('Exception: ', '');
        _isLoading = false;
      });
    }
  }

  Future<void> _handleVerifyOtp() async {
    final phone = _cleanPhone(_phoneController.text);
    final code = _otpController.text.trim();

    if (code.length != 5) {
      setState(() {
        _errorMessage = "5 xonali tasdiqlash kodini kiriting";
      });
      return;
    }

    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      await ApiService().verifyOtp(phone, code);
      if (mounted) {
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const HomeDashboardScreen()),
        );
      }
    } catch (e) {
      setState(() {
        _errorMessage = e.toString().replaceAll('Exception: ', '');
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final isTelegram = _selectedChannel == 'telegram';

    return Scaffold(
      backgroundColor: const Color(0xFF0F172A),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 20.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // 1. Rasmiy Sayt Brend Logotipi (bm-brutto-mark)
                Center(
                  child: Container(
                    width: 82,
                    height: 82,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(22),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFF2563EB).withAlpha(80),
                          blurRadius: 24,
                          offset: const Offset(0, 10),
                        ),
                      ],
                    ),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(22),
                      child: Image.asset(
                        'assets/images/logo.png',
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => Container(
                          color: const Color(0xFF2563EB),
                          child: const Icon(Icons.directions_car, size: 42, color: Colors.white),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 20),

                // Sayt bilan bir xil brend nomi
                const Text(
                  'UYUSHMACHILAR',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1.2,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 4),
                const Text(
                  'Transport platformasi • Haydovchi kabineti',
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 13, color: Color(0xFF94A3B8)),
                ),
                const SizedBox(height: 28),

                // Xatolik xabari
                if (_errorMessage != null)
                  Container(
                    margin: const EdgeInsets.only(bottom: 16),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFF450A0A),
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFF991B1B)),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.error_outline, color: Color(0xFFF87171), size: 20),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _errorMessage!,
                            style: const TextStyle(color: Color(0xFFFCA5A5), fontSize: 13),
                          ),
                        ),
                      ],
                    ),
                  ),

                // KANAL TANLASH VA TELEFON RAQAM KIRITISH
                if (!_isCodeSent) ...[
                  // Kirish usulini tanlash (Telegram / SMS)
                  Container(
                    padding: const EdgeInsets.all(4),
                    decoration: BoxDecoration(
                      color: const Color(0xFF1E293B),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFF334155)),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: GestureDetector(
                            onTap: () => setState(() => _selectedChannel = 'telegram'),
                            child: AnimatedContainer(
                              duration: const Duration(milliseconds: 200),
                              padding: const EdgeInsets.symmetric(vertical: 10),
                              decoration: BoxDecoration(
                                color: isTelegram ? const Color(0xFF0284C7) : Colors.transparent,
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(
                                    Icons.send_rounded,
                                    size: 16,
                                    color: isTelegram ? Colors.white : const Color(0xFF94A3B8),
                                  ),
                                  const SizedBox(width: 6),
                                  Text(
                                    'Telegram orqali',
                                    style: TextStyle(
                                      color: isTelegram ? Colors.white : const Color(0xFF94A3B8),
                                      fontSize: 13,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        Expanded(
                          child: GestureDetector(
                            onTap: () => setState(() => _selectedChannel = 'sms'),
                            child: AnimatedContainer(
                              duration: const Duration(milliseconds: 200),
                              padding: const EdgeInsets.symmetric(vertical: 10),
                              decoration: BoxDecoration(
                                color: !isTelegram ? const Color(0xFF2563EB) : Colors.transparent,
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(
                                    Icons.sms_outlined,
                                    size: 16,
                                    color: !isTelegram ? Colors.white : const Color(0xFF94A3B8),
                                  ),
                                  const SizedBox(width: 6),
                                  Text(
                                    'SMS orqali',
                                    style: TextStyle(
                                      color: !isTelegram ? Colors.white : const Color(0xFF94A3B8),
                                      fontSize: 13,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),

                  const Text(
                    'Telefon raqamingiz',
                    style: TextStyle(color: Color(0xFFCBD5E1), fontSize: 13, fontWeight: FontWeight.w600),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _phoneController,
                    keyboardType: TextInputType.phone,
                    style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
                    decoration: InputDecoration(
                      filled: true,
                      fillColor: const Color(0xFF1E293B),
                      hintText: '+998 90 123 45 67',
                      hintStyle: const TextStyle(color: Color(0xFF64748B)),
                      prefixIcon: const Icon(Icons.phone_android, color: Color(0xFF60A5FA)),
                      contentPadding: const EdgeInsets.symmetric(vertical: 16, horizontal: 16),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: const BorderSide(color: Color(0xFF334155)),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: const BorderSide(color: Color(0xFF334155)),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: const BorderSide(color: Color(0xFF38BDF8), width: 2),
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),

                  // Kod olish tugmasi
                  ElevatedButton(
                    onPressed: _isLoading ? null : () => _handleRequestOtp(),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: isTelegram ? const Color(0xFF0284C7) : const Color(0xFF2563EB),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      elevation: 0,
                    ),
                    child: _isLoading
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
                          )
                        : Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(isTelegram ? Icons.send_rounded : Icons.sms_outlined, size: 18),
                              const SizedBox(width: 8),
                              Text(
                                isTelegram ? 'Kodni Telegramdan olish' : 'Kodni SMS orqali olish',
                                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                              ),
                            ],
                          ),
                  ),
                  const SizedBox(height: 20),

                  // Telegram Botga bevosita o'tish yordamchisi
                  InkWell(
                    onTap: _openTelegramBot,
                    borderRadius: BorderRadius.circular(12),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 14),
                      decoration: BoxDecoration(
                        color: const Color(0xFF0369A1).withAlpha(40),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFF0284C7).withAlpha(80)),
                      ),
                      child: Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              color: const Color(0xFF0284C7),
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: const Icon(Icons.telegram, color: Colors.white, size: 20),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '@$_botUsername',
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 13,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                const Text(
                                  'Bot orqali tezkor kirish va parolsiz tasdiqlash',
                                  style: TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                                ),
                              ],
                            ),
                          ),
                          const Icon(Icons.arrow_forward_ios, color: Color(0xFF38BDF8), size: 14),
                        ],
                      ),
                    ),
                  ),
                ] else ...[
                  // 2. OTP KODINI KIRITISH BOSQICHI
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: _sentChannel == 'telegram'
                          ? const Color(0xFF0369A1).withAlpha(40)
                          : const Color(0xFF1E293B),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: _sentChannel == 'telegram'
                            ? const Color(0xFF0284C7).withAlpha(90)
                            : const Color(0xFF334155),
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          _sentChannel == 'telegram' ? Icons.telegram : Icons.sms_outlined,
                          color: _sentChannel == 'telegram' ? const Color(0xFF38BDF8) : const Color(0xFF60A5FA),
                          size: 24,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _sentChannel == 'telegram'
                                    ? 'Telegram boti orqali kod yuborildi'
                                    : 'SMS orqali kod yuborildi',
                                style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.bold),
                              ),
                              Text(
                                '${_phoneController.text} raqamiga biriktirilgan hisob',
                                style: const TextStyle(color: Color(0xFF94A3B8), fontSize: 11),
                              ),
                            ],
                          ),
                        ),
                        if (_sentChannel == 'telegram')
                          TextButton(
                            onPressed: _openTelegramBot,
                            style: TextButton.styleFrom(
                              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                              backgroundColor: const Color(0xFF0284C7),
                              foregroundColor: Colors.white,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                            ),
                            child: const Text('Botni ochish', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),

                  // 5 xonali PIN maydoni
                  TextField(
                    controller: _otpController,
                    keyboardType: TextInputType.number,
                    maxLength: 5,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 28,
                      letterSpacing: 10,
                      fontWeight: FontWeight.w900,
                    ),
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    onChanged: (val) {
                      if (val.length == 5) {
                        _handleVerifyOtp();
                      }
                    },
                    decoration: InputDecoration(
                      counterText: '',
                      filled: true,
                      fillColor: const Color(0xFF1E293B),
                      hintText: '•••••',
                      hintStyle: const TextStyle(color: Color(0xFF64748B), letterSpacing: 8),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: const BorderSide(color: Color(0xFF334155)),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: const BorderSide(color: Color(0xFF38BDF8), width: 2),
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Center(
                    child: Text(
                      '💡 Sinov kodi: 12345 yoki botdagi kod',
                      style: TextStyle(color: Color(0xFF10B981), fontSize: 12, fontWeight: FontWeight.w600),
                    ),
                  ),
                  const SizedBox(height: 16),

                  ElevatedButton(
                    onPressed: _isLoading ? null : _handleVerifyOtp,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF10B981),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      elevation: 0,
                    ),
                    child: _isLoading
                        ? const SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5),
                          )
                        : const Text(
                            'Tizimga kirish',
                            style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                          ),
                  ),
                  const SizedBox(height: 16),

                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      TextButton(
                        onPressed: () {
                          setState(() {
                            _isCodeSent = false;
                            _otpController.clear();
                          });
                        },
                        child: const Text('Raqamni o\'zgartirish', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 12)),
                      ),
                      TextButton(
                        onPressed: _resendCountdown == 0 ? () => _handleRequestOtp() : null,
                        child: Text(
                          _resendCountdown > 0
                              ? 'Qayta yuborish ($_resendCountdown s)'
                              : 'Qayta yuborish',
                          style: TextStyle(
                            color: _resendCountdown == 0 ? const Color(0xFF38BDF8) : const Color(0xFF64748B),
                            fontSize: 12,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
