from abc import ABC, abstractmethod
import time
from typing import Any, Dict, List

from config.logger import logger
from config.settings import settings


class SessionExpiredError(Exception):
    """Sessiya muddati tugaganda yoki 401/403 qaytganda ko'tariladi."""
    pass


class BaseCollector(ABC):
    """
    Barcha saytlar uchun umumiy asosiy Collector sinfi.
    """
    SOURCE_NAME: str = "base"
    MAX_RETRIES: int = 3
    RETRY_BACKOFF: float = 2.0

    def __init__(self):
        self.settings = settings
        self.logger = logger

    def sleep_rate_limit(self):
        """Saytlarga ortiqcha yuk tushmasligi uchun kutish (rate limiting)."""
        time.sleep(self.settings.RATE_LIMIT_DELAY)

    @abstractmethod
    def fetch(self) -> List[Dict[str, Any]]:
        """Sayt API yoki veb-sahifasidan xomashyo (raw) ma'lumotlarni yig'ish."""
        pass

    @abstractmethod
    def normalize(self, raw_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Yig'ilgan ma'lumotlarni umumiy unified_records sxemasiga o'tkazish."""
        pass

    def run(self) -> List[Dict[str, Any]]:
        """
        Collector'ni retry (qayta urinish) logikasi bilan xavfsiz ishga tushirish.
        """
        last_error = None
        for attempt in range(1, self.MAX_RETRIES + 1):
            try:
                self.logger.info(
                    f"[{self.SOURCE_NAME}] Ma'lumotlarni yig'ish boshlandi (Urinish {attempt}/{self.MAX_RETRIES})..."
                )
                raw_data = self.fetch()
                normalized = self.normalize(raw_data)
                self.logger.info(
                    f"[{self.SOURCE_NAME}] Muvaffaqiyatli yakunlandi: {len(normalized)} ta yozuv."
                )
                return normalized
            except SessionExpiredError:
                # Sessiya tugaganda retry qilmasdan darhol xato berish
                raise
            except Exception as e:
                last_error = e
                self.logger.warning(
                    f"[{self.SOURCE_NAME}] Urinish {attempt} da xatolik yuz berdi: {e}"
                )
                if attempt < self.MAX_RETRIES:
                    wait_time = self.RETRY_BACKOFF ** attempt
                    self.logger.info(f"{wait_time} soniyadan so'ng qayta uriniladi...")
                    time.sleep(wait_time)

        self.logger.error(f"[{self.SOURCE_NAME}] Barcha urinishlar muvaffaqiyatsiz tugadi.")
        raise last_error or Exception(f"[{self.SOURCE_NAME}] Noma'lum xatolik")

