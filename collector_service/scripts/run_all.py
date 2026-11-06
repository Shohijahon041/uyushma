import time
from typing import Any, Dict, Type
from collectors.base import BaseCollector, SessionExpiredError
from collectors.site1 import Site1Collector
from collectors.site2 import Site2Collector
from collectors.site3 import Site3Collector
from config.logger import logger
from database.connection import init_db
from database.repository import save_sync_log, upsert_unified_records
from notifications.telegram_bot import notifier


def run_single_collector(collector_cls: Type[BaseCollector]) -> Dict[str, Any]:
    collector = collector_cls()
    source_name = collector.SOURCE_NAME
    start_time = time.time()

    logger.info(f"===> [{source_name}] Sinxronizatsiya boshlandi...")

    try:
        records = collector.run()
        saved_count = upsert_unified_records(records)
        duration = round(time.time() - start_time, 2)

        save_sync_log(
            source=source_name,
            status="SUCCESS",
            items_count=saved_count,
            duration_sec=duration,
        )
        logger.info(f"===> [V] [{source_name}] Yakunlandi: {saved_count} ta yozuv ({duration} soniya)")
        return {"source": source_name, "status": "SUCCESS", "count": saved_count, "duration": duration}

    except SessionExpiredError as err:
        duration = round(time.time() - start_time, 2)
        error_msg = str(err)
        logger.warning(f"===> [!] [{source_name}] {error_msg}")
        
        save_sync_log(
            source=source_name,
            status="FAILED",
            items_count=0,
            error_message=error_msg,
            duration_sec=duration,
        )
        
        notifier.notify_session_expired(source_name)
        return {"source": source_name, "status": "SESSION_EXPIRED", "count": 0, "error": error_msg}

    except Exception as err:
        duration = round(time.time() - start_time, 2)
        error_msg = str(err)
        logger.error(f"===> [X] [{source_name}] Kutilmagan xatolik: {error_msg}")
        
        save_sync_log(
            source=source_name,
            status="FAILED",
            items_count=0,
            error_message=error_msg,
            duration_sec=duration,
        )
        
        notifier.notify_sync_error(source_name, error_msg)
        return {"source": source_name, "status": "FAILED", "count": 0, "error": error_msg}


def run_all() -> Dict[str, Any]:
    print("\n" + "=" * 70)
    print(" BARCHA MANBALARDAN MA'LUMOTLARNI YIG'ISH BOSHLANDI")
    print("=" * 70)

    init_db()

    collectors = [
        Site1Collector,  # e-tender.uztrans.uz (OneID)
        Site2Collector,  # bm.dtransport.uz (OneID)
        Site3Collector,  # ijara.soliq.uz (E-IMZO)
    ]

    total_start = time.time()
    results = []

    for col in collectors:
        res = run_single_collector(col)
        results.append(res)
        time.sleep(1)

    total_duration = round(time.time() - total_start, 2)
    total_saved = sum(r["count"] for r in results)

    print("\n" + "=" * 70)
    print(f" YAKUNIY NATIJALAR (Jami vaqt: {total_duration} soniya):")
    print("-" * 70)
    for r in results:
        status_symbol = "[V]" if r["status"] == "SUCCESS" else "[X]"
        error_info = f" -> Xatolik: {r.get('error')}" if "error" in r else ""
        print(f" {status_symbol} {r['source']:<15}: {r['count']} ta yozuv ({r['status']}){error_info}")
    print("-" * 70)
    print(f" BAZAGA BIRLASHTIRILGAN JAMI YOZUVLAR: {total_saved}")
    print("=" * 70 + "\n")

    notifier.notify_sync_summary(total_saved, total_duration, results)

    return {
        "total_saved": total_saved,
        "duration": total_duration,
        "details": results,
    }


if __name__ == "__main__":
    run_all()

