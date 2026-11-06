from contextlib import contextmanager
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from config.logger import logger
from config.settings import settings

engine = create_engine(
    settings.DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, expire_on_commit=False, bind=engine)
Base = declarative_base()


def init_db():
    try:
        from database.models import SyncLog, UnifiedRecord  # noqa: F401
        Base.metadata.create_all(bind=engine)
        logger.info("PostgreSQL jadvallari muvaffaqiyatli tekshirildi/yaratildi.")
    except Exception as e:
        logger.error(f"PostgreSQL jadvallarini yaratishda xatolik: {e}")
        raise


@contextmanager
def get_db_session():
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

