-- =============================================================================
-- UYUSHMA GPS & FLEET SAAS EKOTIZIMI - DATABASE SCHEMA
-- PostgreSQL 16 + TimescaleDB (Multi-Tenant High-Load Fleet & GPS Tracking)
-- =============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS "timescaledb" CASCADE;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'TimescaleDB extension o''rnatilmagan, standart PostgreSQL 17 jadvallari ishlatiladi: %', SQLERRM;
END $$;

-- 2. ENUM TYPES
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('SUPER_ADMIN', 'TENANT_ADMIN', 'DISPATCHER', 'DRIVER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE vehicle_status AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE', 'BLOCKED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_provider AS ENUM ('CLICK', 'PAYME', 'BANK_TRANSFER', 'CASH');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE payment_status AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE alert_severity AS ENUM ('INFO', 'WARNING', 'CRITICAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. UPDATED_AT TRIGGER FUNCTION
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. TENANTS TABLE (MCHJ va Uyushmalar)
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    inn VARCHAR(20) NOT NULL UNIQUE,
    contact_phone VARCHAR(20),
    dispatcher_phone VARCHAR(20) DEFAULT '+998901234567',
    settings JSONB NOT NULL DEFAULT '{
        "daily_cron_enabled": true,
        "warning_days_before": 3,
        "auto_block_on_negative_balance": true,
        "auto_block_on_expired_docs": true
    }'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER set_timestamp_tenants
BEFORE UPDATE ON tenants
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- 5. USERS TABLE (Haydovchilar, Dispetcherlar, Adminlar)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    phone VARCHAR(20) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'DRIVER',
    passport_series_number VARCHAR(20),
    pinfl VARCHAR(14),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
    block_reason TEXT,
    fcm_token TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_tenant_role ON users(tenant_id, role);
CREATE INDEX IF NOT EXISTS idx_users_blocked ON users(is_blocked);

CREATE TRIGGER set_timestamp_users
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- 6. OTP CODES TABLE (Eskiz.uz SMS avtorizatsiyasi uchun)
CREATE TABLE IF NOT EXISTS otp_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(20) NOT NULL,
    code VARCHAR(10) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    attempts INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_phone_valid ON otp_codes(phone, is_used, expires_at);

-- 7. VEHICLES TABLE (Yagona Haydovchi va Transport Profili)
CREATE TABLE IF NOT EXISTS vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    plate_number VARCHAR(20) NOT NULL,
    model VARCHAR(100) NOT NULL,
    virtual_gps_id VARCHAR(10) NOT NULL UNIQUE, -- 10-xonali virtual GPS ID (SinoTrack ST-901M emulyatsiyasi)
    
    -- Texpasport bo'yicha haqiqiy egasi
    real_owner_name VARCHAR(255) NOT NULL,
    real_owner_pinfl VARCHAR(14),
    
    -- Hozirgi haydayotgan shaxs
    current_driver_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    -- ijara.soliq.uz ijara shartnomasi
    rental_contract_number VARCHAR(64),
    rental_contract_date DATE,
    rental_contract_expires_at DATE,
    
    -- transport.uz litsenziya varaqasi
    license_sheet_number VARCHAR(64),
    license_sheet_type VARCHAR(100),
    license_sheet_expires_at DATE,
    
    -- etender.uz biriktirilgan yo'nalish / lot
    route_or_lot_number VARCHAR(100),
    
    -- E-OSAGO majburiy avtosug'urta
    insurance_policy_number VARCHAR(64),
    insurance_company VARCHAR(100),
    insurance_expires_at DATE,
    
    -- Moliya va Balans
    monthly_fee NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    balance NUMERIC(14,2) NOT NULL DEFAULT 0.00,
    is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
    block_reason TEXT,
    
    -- Oxirgi GPS holati (tezkor ko'rish uchun kesh)
    last_gps_time TIMESTAMPTZ,
    last_latitude DOUBLE PRECISION,
    last_longitude DOUBLE PRECISION,
    last_speed_kmh REAL DEFAULT 0,
    last_course REAL DEFAULT 0,
    
    status vehicle_status NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT uq_tenant_vehicle_plate UNIQUE (tenant_id, plate_number)
);

CREATE INDEX IF NOT EXISTS idx_vehicles_tenant ON vehicles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_virtual_gps ON vehicles(virtual_gps_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_driver ON vehicles(current_driver_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON vehicles(plate_number);
CREATE INDEX IF NOT EXISTS idx_vehicles_blocked ON vehicles(is_blocked);
CREATE INDEX IF NOT EXISTS idx_vehicles_dates ON vehicles(rental_contract_expires_at, license_sheet_expires_at, insurance_expires_at);

CREATE TRIGGER set_timestamp_vehicles
BEFORE UPDATE ON vehicles
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- 8. GPS_LOGS TABLE (TimescaleDB Hypertable - Yuqori yuklamali GPS tarixi)
CREATE TABLE IF NOT EXISTS gps_logs (
    time TIMESTAMPTZ NOT NULL,
    virtual_gps_id VARCHAR(10) NOT NULL,
    vehicle_id UUID,
    tenant_id UUID,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    speed_kmh REAL NOT NULL DEFAULT 0,
    course REAL NOT NULL DEFAULT 0,
    is_valid BOOLEAN NOT NULL DEFAULT TRUE,
    raw_packet TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TimescaleDB Hypertable yaratish (agar extension mavjud bo'lsa)
DO $$
BEGIN
    PERFORM create_hypertable('gps_logs', 'time', if_not_exists => TRUE, chunk_time_interval => INTERVAL '1 day');
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'create_hypertable o''tkazib yuborildi: %', SQLERRM;
END $$;

-- Yuqori tezlikdagi indekslar
CREATE INDEX IF NOT EXISTS idx_gps_logs_gps_time ON gps_logs (virtual_gps_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_gps_logs_tenant_time ON gps_logs (tenant_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_gps_logs_vehicle_time ON gps_logs (vehicle_id, time DESC);

-- TimescaleDB siqish (compression) va avtomatik tozalash (retention) siyosati
DO $$
BEGIN
    ALTER TABLE gps_logs SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'virtual_gps_id, tenant_id',
        timescaledb.compress_orderby = 'time DESC'
    );
EXCEPTION
    WHEN others THEN null;
END $$;

DO $$
BEGIN
    PERFORM add_compression_policy('gps_logs', INTERVAL '3 days', if_not_exists => TRUE);
    PERFORM add_retention_policy('gps_logs', INTERVAL '90 days', if_not_exists => TRUE);
EXCEPTION
    WHEN others THEN null;
END $$;

-- 9. TRANSACTIONS TABLE (Click va Payme to'lovlari)
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES users(id) ON DELETE SET NULL,
    provider payment_provider NOT NULL,
    provider_trans_id VARCHAR(128) NOT NULL,
    amount NUMERIC(14,2) NOT NULL,
    status payment_status NOT NULL DEFAULT 'PENDING',
    sign_time TIMESTAMPTZ,
    perform_time TIMESTAMPTZ,
    cancel_time TIMESTAMPTZ,
    reason INT,
    raw_payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_provider_trans_id UNIQUE (provider, provider_trans_id)
);

CREATE INDEX IF NOT EXISTS idx_trans_vehicle ON transactions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_trans_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_trans_created ON transactions(created_at DESC);

CREATE TRIGGER set_timestamp_transactions
BEFORE UPDATE ON transactions
FOR EACH ROW
EXECUTE FUNCTION trigger_set_timestamp();

-- 10. SYSTEM ALERTS TABLE (Ogohlantirish va audit xabarlari)
CREATE TABLE IF NOT EXISTS system_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    driver_id UUID REFERENCES users(id) ON DELETE SET NULL,
    severity alert_severity NOT NULL DEFAULT 'WARNING',
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    is_sent BOOLEAN NOT NULL DEFAULT FALSE,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_tenant_created ON system_alerts(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_vehicle ON system_alerts(vehicle_id);

-- 11. DEMO SEED DATA (Ishga tushirish va sinov uchun)
INSERT INTO tenants (id, name, inn, contact_phone, dispatcher_phone)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'CARLUX TRANSPORT MCHJ',
    '309123456',
    '+998936313112',
    '+998901234567'
) ON CONFLICT (inn) DO NOTHING;

INSERT INTO users (id, tenant_id, phone, full_name, role)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    '+998936313112',
    'Alisher Qodirov (Dispetcher)',
    'DISPATCHER'
) ON CONFLICT (phone) DO NOTHING;

INSERT INTO users (id, tenant_id, phone, full_name, role, passport_series_number, pinfl)
VALUES (
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000001',
    '+998901112233',
    'Jamshid Karimov (Haydovchi)',
    'DRIVER',
    'AA1234567',
    '31201901234567'
) ON CONFLICT (phone) DO NOTHING;

INSERT INTO vehicles (
    id,
    tenant_id,
    plate_number,
    model,
    virtual_gps_id,
    real_owner_name,
    real_owner_pinfl,
    current_driver_id,
    rental_contract_number,
    rental_contract_date,
    rental_contract_expires_at,
    license_sheet_number,
    license_sheet_type,
    license_sheet_expires_at,
    route_or_lot_number,
    insurance_policy_number,
    insurance_company,
    insurance_expires_at,
    monthly_fee,
    balance,
    is_blocked,
    last_latitude,
    last_longitude,
    last_speed_kmh
)
VALUES (
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000001',
    '01A777AA',
    'Chevrolet Cobalt',
    '9012345678',
    'Toshmatov Botir Ergashevich',
    '30101851234567',
    '00000000-0000-0000-0000-000000000003',
    'IJARA-2026-99881',
    '2026-01-10',
    '2027-01-10',
    'LIC-UZ-789012',
    'Yo''lovchi tashish (Taksi)',
    '2026-12-31',
    'LOT-44 (Toshkent - Samarqand)',
    'POLIS-EOSAGO-554433',
    'GROSS INSURANCE',
    '2026-12-15',
    350000.00,
    150000.00,
    FALSE,
    41.2995,
    69.2401,
    42.5
) ON CONFLICT (virtual_gps_id) DO NOTHING;

