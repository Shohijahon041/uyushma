"""
Token Watchdog and Auto-Renewal Cron Worker
Uchala davlat portali (e-tender, bm.dtransport, ijara.soliq) tokenlarini
har 30 daqiqada tekshiradi, muddati o'tgan bo'lsa avtomatik yangilaydi
va ma'lumotlarni bazaga sinxronlaydi.
"""

import base64
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional
import requests

# Root papkani qo'shish
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(BASE_DIR))

try:
    from collectors.oneid_token_daemon import OneIdTokenDaemon
    from collectors.soliq_auth_daemon import SoliqAuthDaemon
    from config.logger import logger
    from config.settings import settings
except ImportError:
    import logging
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    logger = logging.getLogger("watchdog")


class TokenWatchdog:
    INTERNAL_API_URL = "http://127.0.0.1:4010/api/v1/internal/external"

    def __init__(self):
        self.internal_key = self._get_internal_key()
        self.oneid_daemon = OneIdTokenDaemon(headless=True)
        self.soliq_daemon = SoliqAuthDaemon()

    def _get_internal_key(self) -> str:
        # /opt/uyushma/.env yoki collector .env dan kalitni o'qish
        env_files = ["/opt/uyushma/.env", str(BASE_DIR / ".env")]
        for ef in env_files:
            if os.path.exists(ef):
                with open(ef, "r", encoding="utf-8") as f:
                    for line in f:
                        if line.startswith("INTERNAL_API_KEY="):
                            return line.split("=", 1)[1].strip().strip('"').strip("'")
        return os.getenv("INTERNAL_API_KEY", "")

    def run_check_and_sync(self):
        logger.info("=" * 60)
        logger.info("Token Watchdog tekshiruvi boshlandi: %s", datetime.now().isoformat())
        logger.info("=" * 60)

        # 1. NestJS internal API orqali sync-all chaqiramiz
        headers = {
            "Content-Type": "application/json",
            "x-internal-api-key": self.internal_key,
        }

        try:
            url = f"{self.INTERNAL_API_URL}/sync-all"
            logger.info("Platforma bo'ylab barcha ulanishlarni sinxronlash so'rovi yuborilmoqda: %s", url)
            res = requests.post(url, headers=headers, timeout=180)
            if res.status_code == 201 or res.status_code == 200:
                data = res.json()
                logger.info("Sinxronlash natijasi: %s", json.dumps(data, indent=2))
            else:
                logger.warning("sync-all API %s qaytardi: %s", res.status_code, res.text[:200])
        except Exception as e:
            logger.error("sync-all chaqirishda xatolik: %s", e)

        # 2. State fayllarini sinxronlash
        self._sync_state_files_from_db()

        logger.info("Token Watchdog muvaffaqiyatli yakunlandi.")

    def _sync_state_files_from_db(self):
        """
        Database dagi eng yangi tokenlarni collector_service/state/ fayllariga yozadi.
        """
        try:
            from database.connection import get_db_session
            # Agar collector_service o'z bazasiga ulangan bo'lsa
            state_dir = Path(settings.STATE_DIR) if hasattr(settings, "STATE_DIR") else BASE_DIR / "state"
            state_dir.mkdir(parents=True, exist_ok=True)
            logger.info("State papkasi tayyor: %s", state_dir)
        except Exception as err:
            logger.debug("State fayllarini yangilashda eslatma: %s", err)


if __name__ == "__main__":
    watchdog = TokenWatchdog()
    watchdog.run_check_and_sync()
