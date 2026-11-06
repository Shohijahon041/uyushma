import signal
import sys
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.interval import IntervalTrigger

from config.logger import logger
from config.settings import settings
from scripts.run_all import run_all


def start_scheduler():
    scheduler = BlockingScheduler(timezone="Asia/Tashkent")
    interval_minutes = getattr(settings, "SYNC_INTERVAL_MINUTES", 30)

    logger.info("Scheduler ishga tushdi. Dastlabki sinxronizatsiya bajarilmoqda...")
    try:
        run_all()
    except Exception as e:
        logger.error(f"Dastlabki sinxronizatsiyada xatolik: {e}")

    scheduler.add_job(
        run_all,
        trigger=IntervalTrigger(minutes=interval_minutes),
        id="sync_all_sources_job",
        name="Barcha manbalarni sinxronizatsiya qilish",
        replace_existing=True,
    )

    logger.info(f"Davriy rejalashtiruvchi sozlandi: har {interval_minutes} daqiqada ishlaydi.")
    print(f"\n[*] Scheduler faol. Har {interval_minutes} daqiqada ma'lumotlar avtomatik yangilanadi.")
    print("[*] To'xtatish uchun: Ctrl + C bosing.\n")

    def handle_exit(sig, frame):
        logger.info("Scheduler to'xtatilmoqda...")
        scheduler.shutdown(wait=False)
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_exit)
    signal.signal(signal.SIGTERM, handle_exit)

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Scheduler to'xtatildi.")


if __name__ == "__main__":
    start_scheduler()

