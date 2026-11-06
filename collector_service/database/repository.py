from typing import Any, Dict, List, Optional
from sqlalchemy import desc, func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from config.logger import logger
from database.connection import get_db_session
from database.models import SyncLog, UnifiedRecord


def upsert_unified_records(records: List[Dict[str, Any]]) -> int:
    if not records:
        return 0

    saved_count = 0
    with get_db_session() as session:
        batch_size = 200
        for i in range(0, len(records), batch_size):
            batch = records[i : i + batch_size]
            
            stmt = pg_insert(UnifiedRecord).values(batch)
            upsert_stmt = stmt.on_conflict_do_update(
                constraint="uq_source_external_id",
                set_={
                    "record_type": stmt.excluded.record_type,
                    "identifier": stmt.excluded.identifier,
                    "title": stmt.excluded.title,
                    "status": stmt.excluded.status,
                    "starts_at": stmt.excluded.starts_at,
                    "ends_at": stmt.excluded.ends_at,
                    "amount": stmt.excluded.amount,
                    "parties": stmt.excluded.parties,
                    "raw_data": stmt.excluded.raw_data,
                    "synced_at": stmt.excluded.synced_at,
                    "updated_at": func.now(),
                },
            )
            session.execute(upsert_stmt)
            saved_count += len(batch)

    logger.info(f"Bazada jami {saved_count} ta yozuv upsert qilindi.")
    return saved_count


def save_sync_log(
    source: str,
    status: str,
    items_count: int = 0,
    error_message: Optional[str] = None,
    duration_sec: float = 0.0,
):
    try:
        with get_db_session() as session:
            log_entry = SyncLog(
                source=source,
                status=status,
                items_count=items_count,
                error_message=error_message,
                duration_sec=duration_sec,
            )
            session.add(log_entry)
    except Exception as e:
        logger.error(f"SyncLog yozishda xatolik: {e}")


def get_all_records(
    source: Optional[str] = None,
    record_type: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> List[UnifiedRecord]:
    with get_db_session() as session:
        query = session.query(UnifiedRecord)
        if source:
            query = query.filter(UnifiedRecord.source == source)
        if record_type:
            query = query.filter(UnifiedRecord.record_type == record_type)
        if search:
            search_pattern = f"%{search}%"
            query = query.filter(
                (UnifiedRecord.identifier.ilike(search_pattern))
                | (UnifiedRecord.title.ilike(search_pattern))
            )
        return (
            query.order_by(desc(UnifiedRecord.updated_at))
            .offset(offset)
            .limit(limit)
            .all()
        )


def get_dashboard_summary() -> Dict[str, Any]:
    with get_db_session() as session:
        total_records = session.query(func.count(UnifiedRecord.id)).scalar() or 0
        total_vehicles = (
            session.query(func.count(func.distinct(UnifiedRecord.identifier)))
            .filter(UnifiedRecord.identifier.isnot(None))
            .scalar()
            or 0
        )
        sources_stat = (
            session.query(UnifiedRecord.source, func.count(UnifiedRecord.id))
            .group_by(UnifiedRecord.source)
            .all()
        )
        recent_logs = (
            session.query(SyncLog)
            .order_by(desc(SyncLog.created_at))
            .limit(10)
            .all()
        )
        return {
            "total_records": total_records,
            "total_vehicles": total_vehicles,
            "by_source": {src: cnt for src, cnt in sources_stat},
            "recent_logs": [
                {
                    "source": l.source,
                    "status": l.status,
                    "items": l.items_count,
                    "error": l.error_message,
                    "duration": l.duration_sec,
                    "at": l.created_at.isoformat() if l.created_at else None,
                }
                for l in recent_logs
            ],
        }

