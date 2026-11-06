import logging
import sys
from pathlib import Path

LOGS_DIR = Path(__file__).resolve().parent.parent / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

logger = logging.getLogger("collector_app")
logger.setLevel(logging.INFO)

formatter = logging.Formatter(
    "[%(asctime)s] [%(levelname)s] [%(name)s]: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

# Konsol handler
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(formatter)
logger.addHandler(console_handler)

# Fayl handler
file_handler = logging.FileHandler(LOGS_DIR / "app.log", encoding="utf-8")
file_handler.setFormatter(formatter)
logger.addHandler(file_handler)

