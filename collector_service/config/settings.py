import os
from pathlib import Path
from dotenv import load_dotenv

# .env yuklash
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


class Settings:
    BASE_DIR: Path = BASE_DIR
    STATE_DIR: Path = BASE_DIR / "state"
    PROFILES_DIR: Path = BASE_DIR / "profiles"

    # Sayt 1: e-tender OneID
    ONEID_LOGIN_1: str = os.getenv("ONEID_LOGIN_1", "")
    ONEID_PASSWORD_1: str = os.getenv("ONEID_PASSWORD_1", "")

    # Sayt 2: bm.dtransport OneID
    ONEID_LOGIN_2: str = os.getenv("ONEID_LOGIN_2", "")
    ONEID_PASSWORD_2: str = os.getenv("ONEID_PASSWORD_2", "")

    # PostgreSQL
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/uyushma_unified"
    )

    # Telegram Bot
    TELEGRAM_BOT_TOKEN: str = os.getenv("TELEGRAM_BOT_TOKEN", "")
    TELEGRAM_CHAT_ID: str = os.getenv("TELEGRAM_CHAT_ID", "")

    # Dashboard & FastAPI
    DASHBOARD_USERNAME: str = os.getenv("DASHBOARD_USERNAME", "admin")
    DASHBOARD_PASSWORD: str = os.getenv("DASHBOARD_PASSWORD", "admin123")
    API_HOST: str = os.getenv("API_HOST", "0.0.0.0")
    API_PORT: int = int(os.getenv("API_PORT", 8000))

    # Collector & Scheduler
    SYNC_INTERVAL_MINUTES: int = int(os.getenv("SYNC_INTERVAL_MINUTES", 30))
    HEADLESS: bool = os.getenv("HEADLESS", "true").lower() in ("true", "1", "yes")
    RATE_LIMIT_DELAY: float = float(os.getenv("RATE_LIMIT_DELAY", 1.0))
    REQUEST_TIMEOUT: int = int(os.getenv("REQUEST_TIMEOUT", 30000))


settings = Settings()

