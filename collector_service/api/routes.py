from pathlib import Path
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from api.auth import get_current_user
from database.connection import get_db_session
from database.models import UnifiedRecord
from database.repository import get_all_records, get_dashboard_summary
from scripts.run_all import run_all

router = APIRouter()

templates_dir = Path(__file__).parent / "templates"
templates = Jinja2Templates(directory=str(templates_dir))


@router.get("/", response_class=HTMLResponse)
def get_dashboard_page(
    request: Request,
    username: str = Depends(get_current_user),
):
    return templates.TemplateResponse(
        request=request,
        name="dashboard.html",
        context={"username": username},
    )


@router.get("/api/summary")
def api_get_summary(username: str = Depends(get_current_user)):
    return get_dashboard_summary()


@router.get("/api/records")
def api_get_records(
    source: Optional[str] = Query(None, description="Manba: etender, bm_dtransport, ijara_soliq"),
    record_type: Optional[str] = Query(None, description="Tur: CAR, CONTRACT, RENT_CONTRACT, DRIVER"),
    search: Optional[str] = Query(None, description="Davlat raqami yoki sarlavha bo'yicha qidiruv"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    username: str = Depends(get_current_user),
):
    p = page if isinstance(page, int) else 1
    ps = page_size if isinstance(page_size, int) else 50
    offset = max(0, (p - 1) * ps)
    records = get_all_records(
        source=source if isinstance(source, str) else None,
        record_type=record_type if isinstance(record_type, str) else None,
        search=search if isinstance(search, str) else None,
        limit=ps,
        offset=offset,
    )
    return [
        {
            "id": r.id,
            "source": r.source,
            "external_id": r.external_id,
            "record_type": r.record_type,
            "identifier": r.identifier,
            "title": r.title,
            "status": r.status,
            "starts_at": r.starts_at.isoformat() if r.starts_at else None,
            "ends_at": r.ends_at.isoformat() if r.ends_at else None,
            "amount": float(r.amount) if r.amount is not None else 0.0,
            "parties": r.parties,
            "synced_at": r.synced_at.isoformat() if r.synced_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        }
        for r in records
    ]


@router.get("/api/records/{record_id}")
def api_get_record_detail(
    record_id: int,
    username: str = Depends(get_current_user),
):
    with get_db_session() as session:
        record = session.query(UnifiedRecord).filter(UnifiedRecord.id == record_id).first()
        if not record:
            return JSONResponse(status_code=404, content={"message": "Yozuv topilmadi"})
        return {
            "id": record.id,
            "source": record.source,
            "external_id": record.external_id,
            "record_type": record.record_type,
            "identifier": record.identifier,
            "title": record.title,
            "status": record.status,
            "starts_at": record.starts_at.isoformat() if record.starts_at else None,
            "ends_at": record.ends_at.isoformat() if record.ends_at else None,
            "amount": float(record.amount) if record.amount is not None else 0.0,
            "parties": record.parties,
            "raw_data": record.raw_data,
            "synced_at": record.synced_at.isoformat() if record.synced_at else None,
            "updated_at": record.updated_at.isoformat() if record.updated_at else None,
        }


sync_status = {"running": False, "last_result": None}


def background_sync_task():
    global sync_status
    try:
        sync_status["running"] = True
        res = run_all()
        sync_status["last_result"] = res
    finally:
        sync_status["running"] = False


@router.post("/api/sync/run")
def api_trigger_sync(
    background_tasks: BackgroundTasks,
    username: str = Depends(get_current_user),
):
    global sync_status
    if sync_status["running"]:
        return {"status": "ALREADY_RUNNING", "message": "Sinxronizatsiya hozirda davom etmoqda"}

    background_tasks.add_task(background_sync_task)
    return {"status": "STARTED", "message": "Sinxronizatsiya orqa fonda ishga tushirildi"}


@router.get("/api/sync/status")
def api_get_sync_status(username: str = Depends(get_current_user)):
    global sync_status
    return sync_status

