"""
=============================================================================
UYUSHMA GPS & FLEET SAAS - HIGH-LOAD H02 TCP PROXY GATEWAY
=============================================================================
Arxitektura:
  - Python 3.12 + asyncio high-concurrency TCP server (100K ulanishlar uchun).
  - SinoTrack ST-901M (H02 protokoli) paketlarini qabul qilish.
  - Real-time forward: Davlat portali (bm.dtransport.uz:20335) ga baytlarni yo'naltirish.
  - Parslash: NMEA koordinatalarini o'nlik formatga o'tkazish, tezlik va sana hisoblash.
  - Kesh va Pub/Sub: Redis (live_gps:<id> va 'gps_stream' kanali).
  - High-Throughput DB Ingestion: asyncio.Queue asosidagi mikro-batching
    orqali PostgreSQL/TimescaleDB ga 10,000+ yozuv/soniya tezlikda yozish.
  - Ilovaga javob: 'ON\\r\\n' qaytarish.
=============================================================================
"""

import asyncio
import datetime
import json
import logging
import os
import re
import signal
import sys
import time
from typing import Any, Dict, List, Optional, Tuple

import asyncpg
import redis.asyncio as aioredis
from dotenv import load_dotenv

# .env yuklash (agar mavjud bo'lsa)
load_dotenv("/opt/uyushma/.env")
load_dotenv()

# Logging sozlamalari
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [H02-GATEWAY] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("h02_gateway")

# Konfiguratsiya parametrlari
GATEWAY_HOST = os.getenv("GATEWAY_HOST", "0.0.0.0")
GATEWAY_PORT = int(os.getenv("GATEWAY_PORT", "20335"))
GOV_GPS_HOST = os.getenv("GOV_GPS_HOST", "bm.dtransport.uz")
GOV_GPS_PORT = int(os.getenv("GOV_GPS_PORT", "20335"))
ENABLE_GOV_FORWARD = os.getenv("ENABLE_GOV_FORWARD", "true").lower() in ("1", "true", "yes")

REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@127.0.0.1:5432/uyushma",
)
if "?" in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.split("?")[0]

# Batching va High-Load parametrlari
DB_BATCH_SIZE = int(os.getenv("DB_BATCH_SIZE", "1000"))
DB_FLUSH_INTERVAL = float(os.getenv("DB_FLUSH_INTERVAL", "0.5"))  # soniya
MAX_QUEUE_SIZE = int(os.getenv("MAX_QUEUE_SIZE", "200000"))
CLIENT_IDLE_TIMEOUT = float(os.getenv("CLIENT_IDLE_TIMEOUT", "120.0"))  # Qotib qolgan soketlarni uzish (soniya)
MAX_CLIENT_BUFFER = int(os.getenv("MAX_CLIENT_BUFFER", "8192"))  # Xotira toshib ketishining oldini olish (bayt)

# Global resurslar
db_pool: Optional[asyncpg.Pool] = None
redis_client: Optional[aioredis.Redis] = None
log_queue: asyncio.Queue = asyncio.Queue(maxsize=MAX_QUEUE_SIZE)
running = True


# H02 protokoli uchun regex
# Format: *HQ,<10_digits>,V1,<HHMMSS>,<A/V>,<Lat>,<N/S>,<Lon>,<E/W>,<Speed>,<Course>,<DDMMYY>,<Status>#
H02_REGEX = re.compile(
    r"^\*HQ,(?P<gps_id>\d{10}),V1,(?P<time>\d{6}),(?P<valid>[AV]),"
    r"(?P<lat>\d{4}\.\d{4}),(?P<ns>[NS]),(?P<lon>\d{5}\.\d{4}),(?P<ew>[EW]),"
    r"(?P<speed>\d{3}(?:\.\d+)?),(?P<course>\d{3}(?:\.\d+)?),(?P<date>\d{6}),"
    r"(?P<status>[0-9A-Fa-f]{8})#$"
)


def parse_nmea_lat(lat_str: str, ns: str) -> float:
    """NMEA 'ddmm.mmmm' formatidan o'nlik darajaga (Decimal Degrees) o'tkazish."""
    degrees = float(lat_str[:2])
    minutes = float(lat_str[2:])
    val = degrees + (minutes / 60.0)
    return -val if ns.upper() == "S" else val


def parse_nmea_lon(lon_str: str, ew: str) -> float:
    """NMEA 'dddmm.mmmm' formatidan o'nlik darajaga (Decimal Degrees) o'tkazish."""
    degrees = float(lon_str[:3])
    minutes = float(lon_str[3:])
    val = degrees + (minutes / 60.0)
    return -val if ew.upper() == "W" else val


def parse_h02_datetime(date_str: str, time_str: str) -> datetime.datetime:
    """
    DDMMYY va HHMMSS qatorlaridan datetime obyektini yasash.
    GPS vaqti odatda UTC bo'ladi.
    """
    try:
        day = int(date_str[0:2])
        month = int(date_str[2:4])
        year = 2000 + int(date_str[4:6])
        hour = int(time_str[0:2])
        minute = int(time_str[2:4])
        second = int(time_str[4:6])
        return datetime.datetime(year, month, day, hour, minute, second, tzinfo=datetime.timezone.utc)
    except Exception:
        return datetime.datetime.now(datetime.timezone.utc)


def parse_h02_packet(raw_text: str) -> Optional[Dict[str, Any]]:
    """
    SinoTrack ST-901M H02 protokol paketini parslash.
    Qaytaradi: Dict yoki None (agar format mos kelmasa).
    """
    raw_clean = raw_text.strip()
    match = H02_REGEX.match(raw_clean)
    if not match:
        return None

    data = match.groupdict()
    is_valid = data["valid"] == "A"
    lat = parse_nmea_lat(data["lat"], data["ns"])
    lon = parse_nmea_lon(data["lon"], data["ew"])
    speed_knots = float(data["speed"])
    speed_kmh = round(speed_knots * 1.852, 2)  # 1 uzel = 1.852 km/soat
    course = float(data["course"])
    point_time = parse_h02_datetime(data["date"], data["time"])

    return {
        "virtual_gps_id": data["gps_id"],
        "is_valid": is_valid,
        "latitude": round(lat, 7),
        "longitude": round(lon, 7),
        "speed_kmh": speed_kmh,
        "course": course,
        "time": point_time,
        "status": data["status"],
        "raw_packet": raw_clean,
    }


class GovForwarder:
    """
    Davlat portali (bm.dtransport.uz:20335) bilan barqaror TCP ulanishini
    boshqaruvchi va kelgan baytlarni asinxron yo'naltiruvchi proksi sinfi.
    100 000 ta mashina oqimida xotira (RAM) toshib ketmasligi uchun
    bounded asyncio.Queue va avtomatik qayta ulanish (Auto-reconnect)
    mexanizmi asosida ishlaydi.
    """

    def __init__(self, host: str, port: int, queue_size: int = 100000):
        self.host = host
        self.port = port
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=queue_size)
        self.writer: Optional[asyncio.StreamWriter] = None
        self.worker_task: Optional[asyncio.Task] = None

    def start(self):
        if not self.worker_task and ENABLE_GOV_FORWARD:
            self.worker_task = asyncio.create_task(self._worker_loop())
            logger.info("Davlat portali (GovForwarder) worker vazifasi ishga tushirildi.")

    async def _get_connection(self) -> Optional[asyncio.StreamWriter]:
        if self.writer and not self.writer.is_closing():
            return self.writer

        try:
            _, writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port), timeout=5.0
            )
            self.writer = writer
            logger.info("Davlat portali bilan TCP ulanish o'rnatildi: %s:%d", self.host, self.port)
            return self.writer
        except Exception as err:
            logger.warning("Davlat portaliga ulanib bo'lmadi (%s:%d): %s", self.host, self.port, err)
            self.writer = None
            return None

    async def _worker_loop(self):
        """Doimiy fonda navbatdagi baytlarni davlat portaliga xavfsiz va uzilishsiz uzatuvchi sikl."""
        reconnect_delay = 1.0
        while running or not self.queue.empty():
            try:
                payload = await asyncio.wait_for(self.queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            except Exception:
                break

            sent = False
            while not sent and running:
                writer = await self._get_connection()
                if not writer:
                    await asyncio.sleep(min(reconnect_delay, 10.0))
                    reconnect_delay = min(reconnect_delay * 1.5, 30.0)
                    continue

                try:
                    writer.write(payload)
                    await asyncio.wait_for(writer.drain(), timeout=3.0)
                    sent = True
                    reconnect_delay = 1.0
                except Exception as e:
                    logger.debug("Davlat portaliga paket uzatishda uzilish: %s. Qayta ulanmoqda...", e)
                    try:
                        writer.close()
                    except Exception:
                        pass
                    self.writer = None
                    await asyncio.sleep(1.0)

            self.queue.task_done()

    def enqueue(self, payload: bytes):
        """Asinxron ravishda paketni navbatga qo'yish (xotira to'lib ketishidan himoyalangan)."""
        if not ENABLE_GOV_FORWARD:
            return
        if not self.queue.full():
            self.queue.put_nowait(payload)
        else:
            logger.warning("GovForwarder navbati to'ldi, paket tashlab ketildi")

    async def close(self):
        if self.worker_task:
            self.worker_task.cancel()
        if self.writer:
            try:
                self.writer.close()
                await self.writer.wait_closed()
            except Exception:
                pass
            self.writer = None


gov_forwarder = GovForwarder(GOV_GPS_HOST, GOV_GPS_PORT)



async def db_batch_worker():
    """
    asyncio.Queue dan to'plangan GPS yozuvlarini olib,
    PostgreSQL/TimescaleDB ga yuqori tezlikda mikro-batch sifatida yozish.
    Bu 100 000 ta qurilma oqimida DB connection pool va disklarni ortiqcha yuklamaydi.
    """
    global running, db_pool, log_queue
    logger.info("TimescaleDB yuqori tezlikdagi batch worker ishga tushdi.")

    while running or not log_queue.empty():
        batch: List[Dict[str, Any]] = []
        deadline = time.time() + DB_FLUSH_INTERVAL

        while time.time() < deadline and len(batch) < DB_BATCH_SIZE:
            try:
                timeout = max(0.01, deadline - time.time())
                item = await asyncio.wait_for(log_queue.get(), timeout=timeout)
                batch.append(item)
                log_queue.task_done()
            except asyncio.TimeoutError:
                break
            except Exception:
                break

        if not batch:
            continue

        if not db_pool:
            logger.warning("DB pool mavjud emas, %d ta yozuv o'tkazib yuborildi.", len(batch))
            continue

        try:
            async with db_pool.acquire() as conn:
                # 1. Hypertable (gps_logs) ga ommaviy kiritish (COPY / Batch Insert)
                records = [
                    (
                        item["time"],
                        item["virtual_gps_id"],
                        item.get("vehicle_id"),
                        item.get("tenant_id"),
                        item["latitude"],
                        item["longitude"],
                        item["speed_kmh"],
                        item["course"],
                        item["is_valid"],
                        item["raw_packet"],
                    )
                    for item in batch
                ]

                await conn.copy_records_to_table(
                    "gps_logs",
                    records=records,
                    columns=[
                        "time",
                        "virtual_gps_id",
                        "vehicle_id",
                        "tenant_id",
                        "latitude",
                        "longitude",
                        "speed_kmh",
                        "course",
                        "is_valid",
                        "raw_packet",
                    ],
                )

                # 2. Eng so'nggi holatni 'vehicles' jadvalida kesh yangilash
                # Virtual GPS ID bo'yicha guruhlab, har bir mashinaning oxirgi nuqtasini yangilaymiz
                latest_by_gps: Dict[str, Dict[str, Any]] = {}
                for itm in batch:
                    latest_by_gps[itm["virtual_gps_id"]] = itm

                update_params = [
                    (
                        val["time"],
                        val["latitude"],
                        val["longitude"],
                        val["speed_kmh"],
                        val["course"],
                        val["virtual_gps_id"],
                    )
                    for val in latest_by_gps.values()
                ]

                await conn.executemany(
                    """
                    UPDATE vehicles
                    SET last_gps_time = $1,
                        last_latitude = $2,
                        last_longitude = $3,
                        last_speed_kmh = $4,
                        last_course = $5,
                        updated_at = NOW()
                    WHERE virtual_gps_id = $6
                    """,
                    update_params,
                )

        except Exception as err:
            logger.error("DB batch saqlashda xatolik: %s (to'plam hajmi: %d)", err, len(batch))


async def handle_h02_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    """
    Har bir alohida haydovchi mobil ilovasi / GPS trekerining TCP sessiyasini qabul qilish.
    100 000 ta parallel ulanishda soketlar qotib qolishining oldini olish uchun
    CLIENT_IDLE_TIMEOUT va MAX_CLIENT_BUFFER cheklovlari o'rnatilgan.
    """
    peer = writer.get_extra_info("peername")
    buffer = b""

    try:
        while running:
            # Socket qotib qolishini oldini oluvchi timeout bilan o'qish (120 soniya)
            try:
                chunk = await asyncio.wait_for(reader.read(1024), timeout=CLIENT_IDLE_TIMEOUT)
            except asyncio.TimeoutError:
                logger.debug("Klient idle timeout (%ss) oshdi, ulanish yopilmoqda: %s", CLIENT_IDLE_TIMEOUT, peer)
                break

            if not chunk:
                break

            buffer += chunk

            # Xotira toshib ketishi (RAM exhaustion) dan himoya
            if len(buffer) > MAX_CLIENT_BUFFER:
                logger.warning("Klient buffer chegaradan oshdi (%d bayt), tozalanmoqda: %s", len(buffer), peer)
                buffer = b""
                continue

            # Paketlar '#' belgisi bilan tugaydi
            while b"#" in buffer:
                idx = buffer.index(b"#")
                packet_bytes = buffer[: idx + 1]
                buffer = buffer[idx + 1 :]

                raw_text = packet_bytes.decode("ascii", errors="ignore").strip()
                if not raw_text.startswith("*HQ"):
                    continue

                # 1. Real-time forward: Davlat portaliga navbat orqali xavfsiz yo'naltirish
                gov_forwarder.enqueue(packet_bytes + b"\r\n")

                # 2. Paketni parslash
                parsed = parse_h02_packet(raw_text)
                if parsed:
                    virtual_gps_id = parsed["virtual_gps_id"]

                    # 3. Redis ga oxirgi koordinata (live_gps:<id>) va Pub/Sub kanaliga yuborish
                    if redis_client:
                        redis_payload = {
                            "virtual_gps_id": virtual_gps_id,
                            "lat": parsed["latitude"],
                            "lng": parsed["longitude"],
                            "speed": parsed["speed_kmh"],
                            "course": parsed["course"],
                            "time": parsed["time"].isoformat(),
                            "valid": parsed["is_valid"],
                        }
                        json_str = json.dumps(redis_payload)

                        # Pipeline orqali tezkor yozish
                        async with redis_client.pipeline(transaction=False) as pipe:
                            pipe.set(f"live_gps:{virtual_gps_id}", json_str, ex=86400)
                            pipe.publish("gps_stream", json_str)
                            await pipe.execute()

                    # 4. TimescaleDB batch navbatiga kiritish
                    if not log_queue.full():
                        log_queue.put_nowait(parsed)
                    else:
                        logger.warning("DB navbati to'lgan! Paket tashlab ketildi: %s", virtual_gps_id)

                    # 5. Ilovaga standart SinoTrack H02 javobini qaytarish
                    writer.write(b"ON\r\n")
                    await writer.drain()

    except (asyncio.IncompleteReadError, ConnectionResetError, BrokenPipeError):
        pass
    except Exception as e:
        logger.debug("Klient bilan aloqada xato (%s): %s", peer, e)
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


async def main():
    global db_pool, redis_client, running

    logger.info("=== H02 TCP PROXY GATEWAY ISHGA TUSHMOQDA (HIGH-LOAD 100K) ===")
    logger.info("Tinglash manzili: %s:%d", GATEWAY_HOST, GATEWAY_PORT)
    logger.info("Davlat portali: %s:%d (Forward: %s)", GOV_GPS_HOST, GOV_GPS_PORT, ENABLE_GOV_FORWARD)

    # 1. Redis ga ulanish
    try:
        redis_client = aioredis.from_url(
            REDIS_URL,
            decode_responses=True,
            max_connections=int(os.getenv("REDIS_MAX_CONNECTIONS", "200")),
        )
        await redis_client.ping()
        logger.info("Redis ga ulanish muvaffaqiyatli: %s", REDIS_URL)
    except Exception as e:
        logger.error("Redis ga ulanishda xato: %s", e)

    # 2. PostgreSQL / TimescaleDB ga ulanish (Connection Pool optimallashtirilgan)
    try:
        db_pool = await asyncpg.create_pool(
            dsn=DATABASE_URL,
            min_size=int(os.getenv("DB_POOL_MIN", "20")),
            max_size=int(os.getenv("DB_POOL_MAX", "100")),
            command_timeout=float(os.getenv("DB_COMMAND_TIMEOUT", "20.0")),
            max_inactive_connection_lifetime=float(os.getenv("DB_MAX_INACTIVE_SEC", "300.0")),
            statement_cache_size=0,
        )
        logger.info("PostgreSQL/TimescaleDB pool yaratildi (min=20, max=100, statement_cache=0).")
    except Exception as e:
        logger.error("Database pool yaratishda xato: %s", e)

    # 3. Davlat portali forward workerini ishga tushirish
    gov_forwarder.start()

    # 4. Fon batch workerini ishga tushirish
    batch_task = asyncio.create_task(db_batch_worker())

    # 5. TCP Serverni ishga tushirish (100K ulanishni qabul qilish uchun)
    server = await asyncio.start_server(
        handle_h02_client,
        GATEWAY_HOST,
        GATEWAY_PORT,
        backlog=4096,
        reuse_address=True,
    )

    # Signal boshqaruvi
    def stop_server():
        global running
        logger.info("Gateway to'xtatilmoqda...")
        running = False
        server.close()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop_server)
        except NotImplementedError:
            pass

    async with server:
        logger.info("H02 TCP Gateway tayyor. Yangi paketlar kutilmoqda...")
        try:
            await server.serve_forever()
        except asyncio.CancelledError:
            pass

    # Yopilish jarayoni
    running = False
    await batch_task
    await gov_forwarder.close()
    if db_pool:
        await db_pool.close()
    if redis_client:
        await redis_client.close()
    logger.info("Gateway to'liq to'xtatildi.")



if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logger.info("Gateway to'xtatildi.")

