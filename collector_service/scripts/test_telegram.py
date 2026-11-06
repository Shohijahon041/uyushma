from notifications.telegram_bot import notifier


def main():
    print("=" * 60)
    print(" Telegram Bot Sinovi")
    print("=" * 60)

    if not notifier.is_configured:
        print("[!] TELEGRAM_BOT_TOKEN yoki TELEGRAM_CHAT_ID sozlanmagan!")
        print("[!] .env faylida ushbu parametrlarni kiriting.")
        return

    print("[*] Telegramga sinov xabari yuborilmoqda...")
    success = notifier.send_message(
        "🚀 <b>Yagona Transport Portali</b>\n\n"
        "Telegram bildirishnomalar tizimi muvaffaqiyatli ishga tushirildi! ✅"
    )

    if success:
        print("[V] MUVAFFAQISAT: Telegramingizga sinov xabari bordi!")
    else:
        print("[X] XATOLIK: Xabar yetkazilmadi. Token va Chat ID ni tekshiring.")


if __name__ == "__main__":
    main()

