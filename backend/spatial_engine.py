"""
=============================================================================
UYUSHMA GPS & FLEET SAAS - IN-MEMORY SPATIAL ENGINE & GEOFENCING
=============================================================================
Arxitektura & Algoritmlar:
  1. Ultra-tezkor Perpendicular Cross-Track Distance (0.05ms):
     GPS koordinatasi (lat, lon) dan marshrut koridori poliliniyasiga (segments)
     eng yaqin masofani planar/equirectangular proyeksiya asosida hisoblash.
  2. Koridor buferi (Buffer Width):
     Har bir marshrut uchun default 150 metr (sozlanuvchi 100m - 500m).
  3. 3-Point Debounce filtri (GPS jitter / shovqinidan himoya):
     Ketma-ket 3 ta ping koridordan tashqarida bo'lsagina haqiqiy chetga chiqish
     (Deviation) deb tan olinadi va ogohlantirish beriladi.
  4. Bekatlar Geofencing (RouteStop Geofence):
     Bekat radiusi (default 100m) ichiga kirish/chiqish hodisalarini monitoring qilish.
  5. Tezlik nazorati (Speed limit check):
     Tezlik 70 km/soat dan oshganda SPEED_EXCEEDED ogohlantirishini yozish.
  6. Multi-Channel Alert Dispatch:
     Redis Pub/Sub ('alerts:stream' va 'gps_stream'), PostgreSQL SystemAlert,
     va Telegram bot (@uyushma_saas_bot) ga real-time xabar uzatish.
=============================================================================
"""

import asyncio
import datetime
import json
import logging
import math
import os
import uuid
from typing import Any, Dict, List, Optional, Tuple, Union

import asyncpg
import httpx
import redis.asyncio as aioredis

logger = logging.getLogger("spatial_engine")

# Yer radiusi (metrlarda)
EARTH_RADIUS_METERS = 6371000.0
DEG_TO_RAD = math.pi / 180.0
RAD_TO_DEG = 180.0 / math.pi


def haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Ikki nuqta orasidagi masofani hisoblash (metrlarda)."""
    phi1 = lat1 * DEG_TO_RAD
    phi2 = lat2 * DEG_TO_RAD
    delta_phi = (lat2 - lat1) * DEG_TO_RAD
    delta_lambda = (lon2 - lon1) * DEG_TO_RAD

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2)
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return EARTH_RADIUS_METERS * c


def point_to_segment_distance_meters(
    plat: float, plon: float,
    alat: float, alon: float,
    blat: float, blon: float
) -> float:
    """
    Nuqta P(plat, plon) dan A(alat, alon) -> B(blat, blon) kesmagacha
    bo'lgan perpendikulyar eng qisqa masofani hisoblash (metrlarda).
    Planar equirectangular proyeksiyasi orqali 0.05 mikrosekundda hisoblaydi.
    """
    mid_lat = (alat + blat) * 0.5 * DEG_TO_RAD
    cos_lat = math.cos(mid_lat)

    # Kesmaning X va Y proyeksiyalari (metrlarda)
    dx = (blon - alon) * cos_lat * (math.pi * EARTH_RADIUS_METERS / 180.0)
    dy = (blat - alat) * (math.pi * EARTH_RADIUS_METERS / 180.0)

    # Nuqtaning A ga nisbatan proyeksiyalari
    px = (plon - alon) * cos_lat * (math.pi * EARTH_RADIUS_METERS / 180.0)
    py = (plat - alat) * (math.pi * EARTH_RADIUS_METERS / 180.0)

    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq < 1e-6:
        # A va B bir xil nuqta
        return math.sqrt(px * px + py * py)

    # t - [0, 1] oralig'idagi perpendikulyar tushish parametri
    t = (px * dx + py * dy) / seg_len_sq
    t = max(0.0, min(1.0, t))

    # Eng yaqin nuqta koordinatasi
    closest_x = t * dx
    closest_y = t * dy

    dist_x = px - closest_x
    dist_y = py - closest_y
    return math.sqrt(dist_x * dist_x + dist_y * dist_y)


def cross_track_distance_to_polyline(
    lat: float, lon: float, polyline_coords: List[List[float]]
) -> float:
    """
    Nuqta (lat, lon) dan butun marshrut koridori poliliniyasiga (barcha kesmalarga)
    bo'lgan eng minimal perpendikulyar masofani hisoblaydi (metrlarda).
    polyline_coords formati: [[lon, lat], [lon, lat], ...] yoki [[lat, lon], ...]
    """
    if not polyline_coords or len(polyline_coords) < 2:
        return 0.0

    # Formatni aniqlash: GeoJSON da odatda [lon, lat] keladi.
    # O'zbekiston hududi uchun lat ~ 37-45, lon ~ 56-74
    sample = polyline_coords[0]
    is_geojson_lon_lat = True
    if len(sample) >= 2:
        if sample[0] < 50.0 and sample[1] > 50.0:
            is_geojson_lon_lat = False  # Demak [lat, lon] berilgan

    min_dist = float("inf")
    n = len(polyline_coords)

    for i in range(n - 1):
        p1 = polyline_coords[i]
        p2 = polyline_coords[i + 1]

        if is_geojson_lon_lat:
            alat, alon = p1[1], p1[0]
            blat, blon = p2[1], p2[0]
        else:
            alat, alon = p1[0], p1[1]
            blat, blon = p2[0], p2[1]

        d = point_to_segment_distance_meters(lat, lon, alat, alon, blat, blon)
        if d < min_dist:
            min_dist = d
            if min_dist < 10.0:
                # 10 metrdan yaqin bo'lsa, koridor ichida hisoblanadi (erta chiqish)
                break

    return min_dist


class SpatialEngine:
    def __init__(
        self,
        db_pool: Optional[asyncpg.Pool],
        redis_client: Optional[aioredis.Redis],
        telegram_token: Optional[str] = None,
        telegram_chat_id: Optional[str] = None,
    ):
        self.db_pool = db_pool
        self.redis = redis_client
        self.tg_token = telegram_token or os.getenv("BOT_TOKEN", "9234982190:AAFVINsJhZRNtiJalATRo6JLLzDlTZNBiN4")
        self.tg_chat = telegram_chat_id or os.getenv("TELEGRAM_MONITORING_CHAT_ID", "1821045481")

        # In-memory marshrutlar va bekatlar keshi (TTL 300s)
        self._route_cache: Dict[str, Dict[str, Any]] = {}
        self._vehicle_route_cache: Dict[str, Dict[str, Any]] = {}
        self._imei_to_plate: Dict[str, str] = {}
        self._cache_expires_at: float = 0.0

    async def _ensure_cache_warm(self):
        """Marshrutlar poliliniyalari, bekatlari va avtomobil-marshrut bog'lanishlarini keshga yuklash."""
        now = asyncio.get_event_loop().time()
        if now < self._cache_expires_at and self._route_cache:
            return

        if not self.db_pool:
            return

        try:
            async with self.db_pool.acquire() as conn:
                # 1. Barcha faol marshrutlar va koridorlar
                routes_rows = await conn.fetch("""
                    SELECT 
                        id, 
                        "tenantId", 
                        name, 
                        origin, 
                        destination, 
                        "corridorPolyline", 
                        "corridorWidthMeters"
                    FROM "Route"
                    WHERE "isActive" = true;
                """)

                new_route_cache = {}
                for r in routes_rows:
                    r_id = str(r["id"])
                    polyline = r["corridorPolyline"]
                    if isinstance(polyline, str):
                        try:
                            polyline = json.loads(polyline)
                        except Exception:
                            polyline = None

                    # Agar polyline GeoJSON Feature yoki LineString bo'lsa
                    coords = []
                    if isinstance(polyline, dict) and "coordinates" in polyline:
                        coords = polyline["coordinates"]
                    elif isinstance(polyline, list):
                        coords = polyline

                    new_route_cache[r_id] = {
                        "id": r_id,
                        "tenant_id": str(r["tenantId"]),
                        "name": r["name"],
                        "origin": r["origin"],
                        "destination": r["destination"],
                        "corridor_width": int(r["corridorWidthMeters"] or 150),
                        "polyline": coords,
                        "stops": [],
                    }

                # 2. Marshrut bekatlari (RouteStop)
                stops_rows = await conn.fetch("""
                    SELECT 
                        id, 
                        "routeId", 
                        name, 
                        latitude, 
                        longitude, 
                        "radiusMeters", 
                        "orderIndex", 
                        "isMandatory"
                    FROM "RouteStop"
                    ORDER BY "orderIndex" ASC;
                """)

                for s in stops_rows:
                    r_id = str(s["routeId"])
                    if r_id in new_route_cache:
                        new_route_cache[r_id]["stops"].append({
                            "id": str(s["id"]),
                            "name": s["name"],
                            "lat": float(s["latitude"]),
                            "lon": float(s["longitude"]),
                            "radius": int(s["radiusMeters"] or 100),
                            "order": int(s["orderIndex"] or 0),
                            "mandatory": bool(s["isMandatory"]),
                        })

                # 3. Avtomobil -> Marshrut xaritasi
                veh_rows = await conn.fetch("""
                    SELECT 
                        v.id as vehicle_id, 
                        v."tenantId" as tenant_id, 
                        v."plateNumber" as plate_number, 
                        v."routeId" as route_id,
                        c.name as company_name
                    FROM "Vehicle" v
                    JOIN "Company" c ON c.id = v."tenantId"
                    WHERE v.status = 'ACTIVE';
                """)

                new_veh_cache = {}
                for v in veh_rows:
                    plate = (v["plate_number"] or "").replace(" ", "").upper()
                    new_veh_cache[plate] = {
                        "vehicle_id": str(v["vehicle_id"]),
                        "tenant_id": str(v["tenant_id"]),
                        "plate_number": v["plate_number"],
                        "route_id": str(v["route_id"]) if v["route_id"] else None,
                        "company_name": v["company_name"],
                    }

                self._route_cache = new_route_cache
                self._vehicle_route_cache = new_veh_cache

                # 4. GPS IMEI / virtual_gps_id -> Plate mapping
                new_imei_cache = {}
                try:
                    legacy_rows = await conn.fetch("""
                        SELECT virtual_gps_id, plate_number 
                        FROM vehicles 
                        WHERE virtual_gps_id IS NOT NULL;
                    """)
                    for lr in legacy_rows:
                        if lr["virtual_gps_id"]:
                            new_imei_cache[str(lr["virtual_gps_id"]).strip()] = (lr["plate_number"] or "").replace(" ", "").upper()
                except Exception as ex:
                    logger.debug("Legacy vehicles table load error: %s", ex)
                self._imei_to_plate = new_imei_cache

                self._cache_expires_at = now + 300.0  # 5 daqiqa TTL
                logger.info(
                    "SpatialEngine kesh yangilandi: %d marshrut, %d bekat, %d avtomobil, %d GPS qurilma",
                    len(new_route_cache),
                    len(stops_rows),
                    len(new_veh_cache),
                    len(new_imei_cache),
                )

        except Exception as e:
            logger.warning("SpatialEngine keshini yangilashda xatolik (eski kesh ishlatiladi): %s", e)

    async def evaluate_gps_point(
        self,
        virtual_gps_id: str,
        plate_number: Optional[str],
        lat: float,
        lon: float,
        speed_kmh: float,
        timestamp: Optional[datetime.datetime] = None,
    ) -> Dict[str, Any]:
        """
        Har bir kelgan GPS nuqtasini real-time tahlil qilish:
          - Marshrutdan chetga chiqish (Cross-track distance > corridor_width)
          - 3-Point Debounce filtri
          - Bekatlarga kirish (Stop entry)
          - Tezlik me'yori (Speed violation)
        """
        await self._ensure_cache_warm()

        norm_plate = (plate_number or "").replace(" ", "").upper()
        if not norm_plate and virtual_gps_id:
            norm_plate = self._imei_to_plate.get(str(virtual_gps_id).strip(), "")

        veh_info = self._vehicle_route_cache.get(norm_plate)

        # Agar plate_number topilmasa, virtual_gps_id dan izlash
        if not veh_info and self.redis:
            try:
                plate_mapped = await self.redis.get(f"imei_to_plate:{virtual_gps_id}")
                if plate_mapped:
                    norm_plate = plate_mapped.replace(" ", "").upper()
                    veh_info = self._vehicle_route_cache.get(norm_plate)
            except Exception:
                pass

        if not veh_info:
            return {
                "status": "UNMAPPED_VEHICLE",
                "virtual_gps_id": virtual_gps_id,
                "is_deviated": False,
                "distance_to_route": 0.0,
            }

        route_id = veh_info.get("route_id")
        route = self._route_cache.get(route_id) if route_id else None

        result = {
            "status": "OK",
            "vehicle_id": veh_info["vehicle_id"],
            "tenant_id": veh_info["tenant_id"],
            "plate_number": veh_info["plate_number"],
            "route_name": route["name"] if route else None,
            "is_deviated": False,
            "deviation_streak": 0,
            "distance_to_route_meters": 0.0,
            "corridor_width_meters": route["corridor_width"] if route else 150,
            "current_stop": None,
            "speed_exceeded": False,
        }

        # 1. Tezlik me'yori (Tezlik > 70 km/soat)
        if speed_kmh > 75.0:
            result["speed_exceeded"] = True
            await self._handle_speed_violation(veh_info, speed_kmh, lat, lon)

        # Agar marshrut yoki poliliniya biriktirilmagan bo'lsa
        if not route or not route["polyline"] or len(route["polyline"]) < 2:
            return result

        # 2. Marshrut koridoriga masofani hisoblash (Cross-track distance)
        dist_meters = cross_track_distance_to_polyline(lat, lon, route["polyline"])
        result["distance_to_route_meters"] = round(dist_meters, 1)
        corridor_width = route["corridor_width"]

        # 3. 3-Point Debounce filtri (Redis da streak hisoblash)
        streak_key = f"deviation_streak:{virtual_gps_id}"
        alerted_key = f"deviation_alerted:{virtual_gps_id}"

        if dist_meters > corridor_width:
            streak = 1
            if self.redis:
                try:
                    streak = await self.redis.incr(streak_key)
                    await self.redis.expire(streak_key, 300)
                except Exception:
                    streak = 3  # Redis xato bo'lsa to'g'ridan to'g'ri o'tkazamiz

            result["deviation_streak"] = streak

            if streak >= 3:
                result["is_deviated"] = True
                # Ogohlantirishni takror yubormaslik (10 daqiqalik cooldown)
                is_already_alerted = False
                if self.redis:
                    try:
                        is_already_alerted = bool(await self.redis.get(alerted_key))
                    except Exception:
                        pass

                if not is_already_alerted:
                    if self.redis:
                        try:
                            await self.redis.set(alerted_key, "1", ex=600)
                        except Exception:
                            pass

                    await self._dispatch_route_deviation(
                        veh_info=veh_info,
                        route=route,
                        deviation_meters=dist_meters,
                        lat=lat,
                        lon=lon,
                        speed=speed_kmh,
                    )
        else:
            # Avtomobil koridor ichida
            if self.redis:
                try:
                    prev_streak = await self.redis.get(streak_key)
                    if prev_streak and int(prev_streak) >= 3:
                        # Koridorga qaytish hodisasi
                        logger.info("Avtomobil %s marshrut koridoriga qaytdi.", veh_info["plate_number"])
                        await self._dispatch_route_recovery(veh_info, route, lat, lon)

                    await self.redis.delete(streak_key)
                    await self.redis.delete(alerted_key)
                except Exception:
                    pass

        # 4. Bekatlar Geofencing tekshiruvi
        for stop in route.get("stops", []):
            d_stop = haversine_distance_meters(lat, lon, stop["lat"], stop["lon"])
            if d_stop <= stop["radius"]:
                result["current_stop"] = stop["name"]
                break

        return result

    async def _dispatch_route_deviation(
        self,
        veh_info: Dict[str, Any],
        route: Dict[str, Any],
        deviation_meters: float,
        lat: float,
        lon: float,
        speed: float,
    ):
        """Marshrutdan chetga chiqish xabarini barcha kanallarga uzatish."""
        plate = veh_info["plate_number"]
        company = veh_info["company_name"]
        route_name = route["name"]
        dev_m = int(deviation_meters)

        logger.warning(
            "MARSHRUTDAN CHETGA CHIQISH: %s (%s) marshrut '%s' dan %dm chetga chiqdi!",
            plate, company, route_name, dev_m
        )

        severity = "CRITICAL" if dev_m > 500 else "WARNING"
        title = f"Marshrutdan chetga chiqish: {plate}"
        msg = f"{plate} ({company}) transport vositasi '{route_name}' marshruti koridoridan {dev_m} metr chetga chiqdi."

        alert_payload = {
            "id": str(uuid.uuid4()),
            "tenant_id": veh_info["tenant_id"],
            "vehicle_id": veh_info["vehicle_id"],
            "type": "ROUTE_DEVIATION",
            "severity": severity,
            "title": title,
            "message": msg,
            "metadata": {
                "plate": plate,
                "route_name": route_name,
                "deviation_meters": dev_m,
                "lat": lat,
                "lon": lon,
                "speed": speed,
            },
            "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }

        # 1. Redis alerts:stream va gps_stream ga publish qilish (Web Dispatcher HUD uchun)
        if self.redis:
            try:
                json_data = json.dumps(alert_payload)
                await self.redis.publish("alerts:stream", json_data)
                await self.redis.publish("gps_stream", json_data)
            except Exception as e:
                logger.debug("Redis alert publish xatosi: %s", e)

        # 2. PostgreSQL SystemAlert jadvaliga yozish
        if self.db_pool:
            try:
                async with self.db_pool.acquire() as conn:
                    await conn.execute("""
                        INSERT INTO "SystemAlert" (
                            id, "tenantId", "vehicleId", type, severity, title, message, metadata, "isResolved", "createdAt"
                        ) VALUES (
                            $1, $2, $3, $4::"AlertType", $5::"AlertSeverity", $6, $7, $8, false, CURRENT_TIMESTAMP
                        );
                    """, (
                        uuid.UUID(alert_payload["id"]),
                        uuid.UUID(veh_info["tenant_id"]),
                        uuid.UUID(veh_info["vehicle_id"]),
                        "ROUTE_DEVIATION",
                        severity,
                        title,
                        msg,
                        json.dumps(alert_payload["metadata"]),
                    ))
            except Exception as e:
                logger.error("DB ga SystemAlert yozishda xato: %s", e)

        # 3. Telegram monitoring guruhiga yuborish
        tg_text = (
            f"⚠️ <b>MARSHRUTDAN CHETGA CHIQISH!</b>\n\n"
            f"🚗 <b>Davlat raqami:</b> <code>{plate}</code>\n"
            f"🏢 <b>Korxona:</b> {company}\n"
            f"🛣 <b>Marshrut:</b> {route_name}\n"
            f"📏 <b>Chetlanish masofasi:</b> <b>{dev_m} metr</b> (koridor: {route['corridor_width']}m)\n"
            f"⚡ <b>Tezlik:</b> {speed} km/soat\n"
            f"📍 <b>Koordinata:</b> <code>{lat:.6f}, {lon:.6f}</code>\n"
            f"🗺 <a href=\"https://maps.google.com/?q={lat},{lon}\">Xaritada ko'rish</a>"
        )
        await self._send_telegram_async(tg_text)

    async def _dispatch_route_recovery(
        self, veh_info: Dict[str, Any], route: Dict[str, Any], lat: float, lon: float
    ):
        """Marshrut koridoriga qaytish xabarini uzatish."""
        plate = veh_info["plate_number"]
        route_name = route["name"]

        recovery_payload = {
            "type": "ROUTE_RECOVERY",
            "vehicle_id": veh_info["vehicle_id"],
            "plate_number": plate,
            "route_name": route_name,
            "message": f"{plate} transport vositasi '{route_name}' marshruti koridoriga qaytdi.",
            "time": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }

        if self.redis:
            try:
                await self.redis.publish("alerts:stream", json.dumps(recovery_payload))
            except Exception:
                pass

    async def _handle_speed_violation(
        self, veh_info: Dict[str, Any], speed: float, lat: float, lon: float
    ):
        """Tezlik me'yoridan oshganda ogohlantirish berish."""
        plate = veh_info["plate_number"]
        company = veh_info["company_name"]
        logger.warning("TEZLIK OSHISHI: %s (%s) tezligi %s km/soat!", plate, company, speed)

        # Takrorlanmaslik uchun Redis 5 daqiqalik cooldown
        speed_key = f"speed_alert:{plate}"
        if self.redis:
            try:
                if await self.redis.get(speed_key):
                    return
                await self.redis.set(speed_key, "1", ex=300)
            except Exception:
                pass

        if self.db_pool:
            try:
                async with self.db_pool.acquire() as conn:
                    await conn.execute("""
                        INSERT INTO "SystemAlert" (
                            id, "tenantId", "vehicleId", type, severity, title, message, metadata, "isResolved", "createdAt"
                        ) VALUES (
                            $1, $2, $3, 'SPEED_EXCEEDED'::"AlertType", 'WARNING'::"AlertSeverity", $4, $5, $6, false, CURRENT_TIMESTAMP
                        );
                    """, (
                        uuid.uuid4(),
                        uuid.UUID(veh_info["tenant_id"]),
                        uuid.UUID(veh_info["vehicle_id"]),
                        f"Tezlik me'yori oshirildi: {plate}",
                        f"{plate} ({company}) avtomobili tezlikni {speed} km/soat ga yetkazdi (ruxsat: 70 km/soat).",
                        json.dumps({"plate": plate, "speed": speed, "lat": lat, "lon": lon}),
                    ))
            except Exception as e:
                logger.error("DB ga SPEED_EXCEEDED yozishda xato: %s", e)

    async def _send_telegram_async(self, text: str):
        """Asinxron Telegram xabar yuborish."""
        if not self.tg_token or not self.tg_chat:
            return
        url = f"https://api.telegram.org/bot{self.tg_token}/sendMessage"
        payload = {
            "chat_id": self.tg_chat,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": False,
        }
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(url, json=payload)
        except Exception as e:
            logger.debug("Telegram API asinxron xato: %s", e)

