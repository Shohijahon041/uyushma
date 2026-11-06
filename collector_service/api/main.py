from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from api.routes import router
from config.logger import logger
from config.settings import settings
from database.connection import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("FastAPI serveri ishga tushmoqda, baza tekshirilmoqda...")
    init_db()
    yield
    logger.info("FastAPI serveri to'xtatildi.")


app = FastAPI(
    title="Yagona Transport & Ijara Portali",
    description="e-tender.uztrans.uz, bm.dtransport.uz va ijara.soliq.uz ma'lumotlari agregatori",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


def run():
    host = getattr(settings, "API_HOST", "0.0.0.0")
    port = int(getattr(settings, "API_PORT", 8000))
    logger.info(f"Server ishga tushmoqda: http://{host}:{port}")
    uvicorn.run("api.main:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    run()

