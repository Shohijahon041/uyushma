from typing import Any, Dict, List, Optional
import requests

from config.logger import logger
from config.settings import settings


class TelegramNotifier:
    def __init__(self):
        self.bot_token = getattr(settings, "TELEGRAM_BOT_TOKEN", None)
        self.chat_id = getattr(settings, "TELEGRAM_CHAT_ID", None)

    @property
    def is_configured(self) -> bool:
        return bool(self.bot_token and self.chat_id)

    def send_message(self, text: str, parse_mode: str = "HTML") -> bool:
        if not self.is_configured:
            logger.debug("Telegram bot sozlanmagan (TELEGRAM_BOT_TOKEN yoki CHAT_ID yo'q).")
            return False

        url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
        payload = {
            "chat_id": self.chat_id,
            "text": text,
            "parse_mode": parse_mode,
            "disable_web_page_preview": True,
        }

        try:
            response = requests.post(url, json=payload, timeout=10)
            if response.status_code == 200:
                logger.info("Telegram xabari muvaffaqiyatli yuborildi.")
                return True
            else:
                logger.warning(
                    f"Telegram xabar yuborishda xatolik ({response.status_code}): {response.text}"
                )
                return False
        except Exception as err:
            logger.error(f"Telegram API ga ulanishda xatolik: {err}")
            return False

    def notify_session_expired(self, source: str):
        message = (
            f"⚠️ <b>DIQQAT: Sessiya muddati tugadi!</b>\n\n"
            f"Manba: <code>{source}</code> (ijara.soliq.uz)\n"
            f"Sabab: E-IMZO sessiyasi eskirgan yoki login talab qilinmoqda.\n\n"
            f"🔄 <b>Qayta kirish uchun serverda quyidagi buyruqni bosing:</b>\n"
            f"<code>python -m scripts.login_ijara</code>\n\n"
            f"<i>Boshqa saytlardan ma'lumot yig'ish odatdagi tartibda davom etmoqda.</i>"
        )
        self.send_message(message)

    def notify_sync_error(self, source: str, error_msg: str):
        message = (
            f"❌ <b>Sinxronizatsiya xatosi!</b>\n\n"
            f"Manba: <code>{source}</code>\n"
            f"Xatolik: <code>{error_msg[:300]}</code>\n"
        )
        self.send_message(message)

    def notify_sync_summary(self, total_saved: int, duration: float, details: List[Dict[str, Any]]):
        lines = [
            f"📊 <b>Sinxronizatsiya yakunlandi</b>",
            f"⏱ Vaqt: {duration}s | Jami yangilangan: <b>{total_saved}</b> ta\n",
        ]
        for item in details:
            status_icon = "✅" if item["status"] == "SUCCESS" else "⚠️"
            lines.append(f"{status_icon} <code>{item['source']}</code>: {item.get('count', 0)} ta ({item['status']})")

        self.send_message("\n".join(lines))


notifier = TelegramNotifier()

