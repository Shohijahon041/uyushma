from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Dict, List, Optional
from playwright.sync_api import sync_playwright

from collectors.base import BaseCollector, SessionExpiredError
from config.logger import logger
from config.settings import settings


class Site2Collector(BaseCollector):
    SOURCE_NAME = "bm_dtransport"
    BASE_URL = "https://bm.dtransport.uz"
    API_BASE_URL = "https://bmapi.dtransport.uz"
    SSO_LOGIN_URL = "https://id.egov.uz/oz?client_id=bm_dtransport_uz&token_id=27da5376-2a4d-4b4a-b279-d1ace4be9fc3&method=IDPW"

    def __init__(self):
        super().__init__()
        self.state_file = Path(settings.STATE_DIR) / "state_2.json"
        self.state_file.parent.mkdir(parents=True, exist_ok=True)

    def _login(self, page) -> str:
        login = settings.ONEID_LOGIN_2
        password = settings.ONEID_PASSWORD_2

        if not login or not password:
            raise ValueError("ONEID_LOGIN_2 yoki ONEID_PASSWORD_2 sozlanmagan!")
        if "sizning" in login.lower() or "sizning" in password.lower():
            raise SessionExpiredError(
                "bm.dtransport OneID login/parol hali kiritilmagan. Sozlamalar bo'limidan "
                "avtopark ulanishini qayta oching."
            )

        logger.info(f"[{self.SOURCE_NAME}] OneID sahifasiga o'tilmoqda: {self.SSO_LOGIN_URL}")
        page.goto(self.SSO_LOGIN_URL, wait_until="domcontentloaded", timeout=45000)

        # Foydalanuvchi va parol kiritish
        page.wait_for_selector('input[name="username"], input#username, input[type="text"]', timeout=15000)
        page.fill('input[name="username"], input#username, input[type="text"]', login)
        page.fill('input[name="password"], input#password, input[type="password"]', password)
        page.click('button[type="submit"], input[type="submit"], .btn-primary')

        # bm.dtransport.uz ga qaytishini kutish
        page.wait_for_url(lambda u: "bm.dtransport.uz" in u, timeout=45000)
        self.sleep_rate_limit()

        # Tokenni Keycloak / Redux persist dan olish
        token = page.evaluate("""() => {
            const raw = localStorage.getItem('persist:root');
            if (raw) {
                try {
                    const parsed = JSON.parse(raw);
                    if (parsed.auth) {
                        const auth = JSON.parse(parsed.auth);
                        if (auth.token) return auth.token;
                        if (auth.accessToken) return auth.accessToken;
                    }
                } catch(e) {}
            }
            return localStorage.getItem('token') 
                || localStorage.getItem('access_token') 
                || localStorage.getItem('kc-token') 
                || null;
        }""")

        page.context.storage_state(path=str(self.state_file))
        logger.info(f"[{self.SOURCE_NAME}] Sessiya holati saqlandi: {self.state_file}")
        return token or ""

    def fetch(self) -> List[Dict[str, Any]]:
        raw_items = []
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=settings.HEADLESS)
            context = None

            if self.state_file.exists():
                try:
                    context = browser.new_context(storage_state=str(self.state_file))
                except Exception:
                    context = browser.new_context()
            else:
                context = browser.new_context()

            page = context.new_page()

            try:
                page.goto(f"{self.BASE_URL}/", wait_until="domcontentloaded", timeout=45000)
                if "id.egov.uz" in page.url or "login" in page.url.lower():
                    logger.info(f"[{self.SOURCE_NAME}] Sessiya eskirgan, qayta kirilmoqda...")
                    self._login(page)

                token = page.evaluate("""() => {
                    const raw = localStorage.getItem('persist:root');
                    if (raw) {
                        try {
                            const parsed = JSON.parse(raw);
                            if (parsed.auth) {
                                const auth = JSON.parse(parsed.auth);
                                if (auth.token) return auth.token;
                            }
                        } catch(e) {}
                    }
                    return localStorage.getItem('token') || localStorage.getItem('access_token') || null;
                }""")

                headers = {}
                if token:
                    clean = token.replace("Bearer ", "").strip()
                    headers["Authorization"] = f"Bearer {clean}"

                # 1. Transport vositalarini yuklash
                vehicles_url = f"{self.API_BASE_URL}/non-brutto-management/api/v1/vehicles"
                resp_veh = page.request.get(vehicles_url, headers=headers)
                if resp_veh.status in (401, 403):
                    # Ikkinchi variant: brutto-management
                    resp_veh = page.request.get(f"{self.API_BASE_URL}/brutto-management/api/v1/vehicles", headers=headers)
                if resp_veh.status in (401, 403):
                    raise SessionExpiredError(
                        f"[{self.SOURCE_NAME}] Avtorizatsiya xatosi ({resp_veh.status}) — qayta kiring"
                    )

                if resp_veh.status == 200:
                    data = resp_veh.json()
                    items = data.get("data") if isinstance(data, dict) else data
                    if isinstance(items, list):
                        for it in items:
                            it["_api_type"] = "VEHICLE"
                            raw_items.append(it)
                self.sleep_rate_limit()

                # 2. Haydovchilarni yuklash
                drivers_url = f"{self.API_BASE_URL}/api/v1/drivers"
                resp_driv = page.request.get(drivers_url, headers=headers)
                if resp_driv.status == 200:
                    d_data = resp_driv.json()
                    d_items = d_data.get("data") if isinstance(d_data, dict) else d_data
                    if isinstance(d_items, list):
                        for it in d_items:
                            it["_api_type"] = "DRIVER"
                            raw_items.append(it)

            finally:
                browser.close()

        return raw_items

    def normalize(self, raw_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        normalized = []
        for item in raw_items:
            api_type = item.get("_api_type", "UNKNOWN")

            if api_type == "VEHICLE":
                plate = (
                    item.get("plateNumber")
                    or item.get("plateNum")
                    or item.get("stateNumber")
                    or ""
                ).replace(" ", "").upper()
                ext_id = f"bm_veh_{item.get('id') or item.get('vehicleId') or plate}"
                model = item.get("vehicleModel") or item.get("model") or ""
                route = item.get("routeVariantName") or item.get("routeName") or ""
                title = f"Avtobus: {plate} ({model})" + (f" - Yo'nalish: {route}" if route else "")

                normalized.append({
                    "source": self.SOURCE_NAME,
                    "external_id": ext_id,
                    "record_type": "CAR",
                    "identifier": plate,
                    "title": title.strip(),
                    "status": "ACTIVE",
                    "starts_at": None,
                    "ends_at": None,
                    "amount": 0.0,
                    "parties": {
                        "organization_name": item.get("organizationName") or item.get("companyName"),
                        "garage_number": item.get("garageNumber"),
                    },
                    "raw_data": item,
                    "synced_at": datetime.now(timezone.utc).isoformat(),
                })

            elif api_type == "DRIVER":
                full_name = item.get("fullName") or item.get("name") or "Noma'lum haydovchi"
                pinfl = item.get("pinfl") or ""
                ext_id = f"bm_driver_{item.get('id') or pinfl or full_name}"

                normalized.append({
                    "source": self.SOURCE_NAME,
                    "external_id": ext_id,
                    "record_type": "DRIVER",
                    "identifier": pinfl or full_name,
                    "title": f"Haydovchi: {full_name}",
                    "status": "ACTIVE",
                    "starts_at": None,
                    "ends_at": None,
                    "amount": 0.0,
                    "parties": {
                        "driver_name": full_name,
                        "pinfl": pinfl,
                        "phone": item.get("phone"),
                        "license_number": item.get("licenseNumber"),
                    },
                    "raw_data": item,
                    "synced_at": datetime.now(timezone.utc).isoformat(),
                })

        return normalized

