"""
Soliq E-IMZO Token Daemon
ijara.soliq.uz avtorizatsiya va token monitoring dvigateli.
Token holatini tekshiradi, muddati o'tgan bo'lsa yangilaydi yoki Telegram bot orqali bildirishnoma yuboradi.
"""

import json
import os
import sys
from pathlib import Path
from typing import Dict, Optional, Tuple
import requests

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(BASE_DIR))

try:
    from config.logger import logger
    from config.settings import settings
except ImportError:
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger("soliq_daemon")
    class DummySettings:
        TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
        TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
    settings = DummySettings()


class SoliqAuthDaemon:
    BASE_URL = "https://ijara.soliq.uz"
    PING_ENDPOINT = "/api/transport-rent/client/transport-rent/contract/get-list/by-params?page=0&size=1&limit=1&myRentType=1&statusGroup=1"
    AUTH_EIMZO_ENDPOINT = "/api/auth/eimzo"

    def __init__(self):
        self.profile_dir = Path(settings.PROFILES_DIR) / "ijara_profile" if hasattr(settings, "PROFILES_DIR") else BASE_DIR / "profiles" / "ijara_profile"

    def check_token_health(self, token: str) -> Tuple[bool, int, str]:
        """Token yaroqliligini tekshiradi."""
        if not token:
            return False, 401, "Token mavjud emas"

        clean_token = token.replace("Bearer ", "").strip()
        headers = {
            "Authorization": f"Bearer {clean_token}",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        }

        try:
            url = f"{self.BASE_URL}{self.PING_ENDPOINT}"
            res = requests.get(url, headers=headers, timeout=15)
            if res.status_code == 200:
                return True, 200, "Token faol va yaroqli"
            elif res.status_code in (401, 403):
                return False, res.status_code, "Token muddati tugagan yoki bekor qilingan (401/403)"
            else:
                return False, res.status_code, f"Soliq serveri javobi: {res.status_code}"
        except Exception as e:
            return False, 500, f"Ulanish xatosi: {str(e)}"

    def notify_token_expired(self, message: Optional[str] = None):
        """Telegram orqali mas'ul shaxsga tezkor bildirishnoma yuboradi."""
        bot_token = getattr(settings, "TELEGRAM_BOT_TOKEN", "")
        chat_id = getattr(settings, "TELEGRAM_CHAT_ID", "")
        if not bot_token or not chat_id:
            logger.warning("[SOLIQ] Telegram bot yoki chat_id sozlanmagan, xabar yuborilmadi.")
            return

        text = (
            "⚠️ <b>DIQQAT: ijara.soliq.uz Tokeni Eskirdi!</b>\n\n"
            "Avtotransport ijara shartnomalarini avtomatik sinxronlash to'xtab qolmasligi uchun "
            "iltimos, tizimga kirib Soliq E-IMZO tokenini yangilang.\n\n"
            f"ℹ️ Sabab: {message or 'Token muddati tugagan (HTTP 401)'}\n"
            "🔗 Yangilash manzili: https://uyushma.bmbrutto.uz/collector"
        )

        try:
            url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
            requests.post(url, json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"}, timeout=10)
            logger.info("[SOLIQ] Telegram orqali ogohlantirish yuborildi.")
        except Exception as e:
            logger.error(f"[SOLIQ] Telegram yuborishda xatolik: {e}")


def verify_soliq_connection(token: str) -> bool:
    daemon = SoliqAuthDaemon()
    ok, code, msg = daemon.check_token_health(token)
    if not ok:
        logger.warning(f"[SOLIQ HEALTHCHECK] {msg} (code={code})")
    else:
        logger.info(f"[SOLIQ HEALTHCHECK] OK: {msg}")
    return ok


if __name__ == "__main__":
    if len(sys.argv) > 1:
        tok = sys.argv[1]
        daemon = SoliqAuthDaemon()
        is_ok, sc, info = daemon.check_token_health(tok)
        print(f"Status: {sc}, Healthy: {is_ok}, Info: {info}")
    else:
        print("Foydalanish: python soliq_auth_daemon.py <token>")
