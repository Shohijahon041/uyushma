from datetime import datetime, timezone
from sqlalchemy import (
    Column,
    DateTime,
    Float,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB

from database.connection import Base


class UnifiedRecord(Base):
    __tablename__ = "unified_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    source = Column(String(50), nullable=False, index=True)
    external_id = Column(String(150), nullable=False, index=True)
    record_type = Column(String(50), nullable=False, index=True)
    
    identifier = Column(String(100), nullable=True, index=True)
    title = Column(String(255), nullable=True)
    status = Column(String(50), nullable=True, index=True)
    
    starts_at = Column(DateTime(timezone=True), nullable=True)
    ends_at = Column(DateTime(timezone=True), nullable=True)
    amount = Column(Numeric(15, 2), nullable=True, default=0.0)
    
    parties = Column(JSONB, nullable=True, default={})
    raw_data = Column(JSONB, nullable=True, default={})
    
    synced_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    __table_args__ = (
        UniqueConstraint("source", "external_id", name="uq_source_external_id"),
        Index("ix_source_record_type", "source", "record_type"),
        Index("ix_identifier_source", "identifier", "source"),
    )

    def __repr__(self):
        return f"<UnifiedRecord(source='{self.source}', external_id='{self.external_id}', identifier='{self.identifier}')>"


class SyncLog(Base):
    __tablename__ = "sync_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    source = Column(String(50), nullable=False, index=True)
    status = Column(String(20), nullable=False)
    items_count = Column(Integer, nullable=False, default=0)
    error_message = Column(Text, nullable=True)
    duration_sec = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    def __repr__(self):
        return f"<SyncLog(source='{self.source}', status='{self.status}', items={self.items_count})>"

