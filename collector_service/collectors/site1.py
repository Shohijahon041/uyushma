from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any, Dict, List, Optional
from playwright.sync_api import sync_playwright

from collectors.base import BaseCollector, SessionExpiredError
from config.logger import logger
from config.settings import settings


class Site1Collector(BaseCollector):
    SOURCE_NAME = "etender"
    BASE_URL = "https://e-tender.uztrans.uz"
    API_BASE_URL = "https://e-tenderapi.uztrans.uz"
    SSO_LOGIN_URL = "https://id.egov.uz/oz?client_id=e-tender_uztrans_uz&token_id=79e00cb6-9c85-4309-9941-4ec1e978cfe0&method=IDPW"

    def __init__(self):
        super().__init__()
        self.state_file = Path(settings.STATE_DIR) / "state_1.json"
        self.state_file.parent.mkdir(parents=True, exist_ok=True)

    def _login(self, page) -> str:
        """OneID orqali avtomatik login qilib, storage_state va token saqlaydi."""
        login = settings.ONEID_LOGIN_1
        password = settings.ONEID_PASSWORD_1

        if not login or not password:
            raise ValueError("ONEID_LOGIN_1 yoki ONEID_PASSWORD_1 sozlanmagan!")
        if "sizning" in login.lower() or "sizning" in password.lower():
            raise SessionExpiredError(
                "e-tender OneID login/parol hali kiritilmagan. Sozlamalar bo'limidan "
                "e-tender ulanishini qayta oching."
            )

        logger.info(f"[{self.SOURCE_NAME}] OneID sahifasiga o'tilmoqda...")
        page.goto(self.SSO_LOGIN_URL, wait_until="domcontentloaded", timeout=45000)

        # Login maydoniga kiritish
        page.wait_for_selector('input[name="username"], input#username, input[type="text"]', timeout=15000)
        page.fill('input[name="username"], input#username, input[type="text"]', login)

        # Parol maydoniga kiritish
        page.fill('input[name="password"], input#password, input[type="password"]', password)

        # Kirish tugmasini bosish
        page.click('button[type="submit"], input[type="submit"], .btn-primary')

        # Asosiy saytga qaytishini kutish
        page.wait_for_url(lambda u: "e-tender.uztrans.uz" in u, timeout=45000)
        self.sleep_rate_limit()

        # Tokenni localStorage dan olish
        token = page.evaluate("""() => {
            return localStorage.getItem('token') 
                || localStorage.getItem('access_token') 
                || sessionStorage.getItem('token') 
                || null;
        }""")

        page.context.storage_state(path=str(self.state_file))
        logger.info(f"[{self.SOURCE_NAME}] Yangi sessiya holati saqlandi: {self.state_file}")
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
                # 1. Sessiyani tekshirish
                page.goto(f"{self.BASE_URL}/", wait_until="domcontentloaded", timeout=45000)
                if "id.egov.uz" in page.url or "login" in page.url.lower():
                    logger.info(f"[{self.SOURCE_NAME}] Sessiya eskirgan, qayta kirilmoqda...")
                    self._login(page)

                token = page.evaluate("""() => {
                    return localStorage.getItem('token') 
                        || localStorage.getItem('access_token') 
                        || null;
                }""")

                headers = {}
                if token:
                    clean_token = token.replace("Bearer ", "").strip()
                    headers["Authorization"] = f"Bearer {clean_token}"

                # 2. Mashinalar ro'yxatini yuklash
                cars_url = f"{self.API_BASE_URL}/api/user/get-cars"
                resp_cars = page.request.get(cars_url, headers=headers)
                if resp_cars.status in (401, 403):
                    raise SessionExpiredError(f"[{self.SOURCE_NAME}] Token yaroqsiz ({resp_cars.status})")
                if resp_cars.status == 200 and "json" not in (resp_cars.headers.get("content-type") or "").lower():
                    raise SessionExpiredError(
                        f"[{self.SOURCE_NAME}] API JSON o'rniga HTML qaytardi — sessiya eskirgan"
                    )
                if resp_cars.status == 200:
                    cars_data = resp_cars.json()
                    cars_list = cars_data.get("data") if isinstance(cars_data, dict) else cars_data
                    if isinstance(cars_list, list):
                        for c in cars_list:
                            c["_api_type"] = "CAR"
                            raw_items.append(c)
                self.sleep_rate_limit()

                # 3. Shartnomalar
                contracts_url = f"{self.API_BASE_URL}/api/contract/user"
                resp_contr = page.request.get(contracts_url, headers=headers)
                if resp_contr.status == 200:
                    contr_data = resp_contr.json()
                    contr_list = contr_data.get("data") if isinstance(contr_data, dict) else contr_data
                    if isinstance(contr_list, list):
                        for c in contr_list:
                            c["_api_type"] = "CONTRACT"
                            raw_items.append(c)
                self.sleep_rate_limit()

                # 4. Guvohnomalar (Certificates)
                cert_url = f"{self.API_BASE_URL}/api/certificate/user"
                resp_cert = page.request.get(cert_url, headers=headers)
                if resp_cert.status == 200:
                    cert_data = resp_cert.json()
                    cert_list = cert_data.get("data") if isinstance(cert_data, dict) else cert_data
                    if isinstance(cert_list, list):
                        for c in cert_list:
                            c["_api_type"] = "CERTIFICATE"
                            raw_items.append(c)

            finally:
                browser.close()

        return raw_items

    def normalize(self, raw_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        normalized = []
        for item in raw_items:
            api_type = item.get("_api_type", "UNKNOWN")

            if api_type == "CAR":
                plate = (
                    item.get("automobile_number")
                    or item.get("auto_number")
                    or item.get("plate_number")
                    or ""
                ).replace(" ", "").upper()
                ext_id = f"etender_car_{item.get('car_id') or plate}"
                title = f"Avtomobil: {plate} ({item.get('busmarka') or item.get('model') or ''})"

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
                    "parties": {"company_name": item.get("company_name")},
                    "raw_data": item,
                    "synced_at": datetime.now(timezone.utc).isoformat(),
                })

            elif api_type == "CONTRACT":
                contract_num = item.get("number") or str(item.get("id"))
                ext_id = f"etender_contract_{item.get('id') or contract_num}"
                plate = ""
                cars = item.get("cars") or []
                if cars and isinstance(cars, list) and isinstance(cars[0], dict):
                    plate = cars[0].get("auto_number") or ""

                normalized.append({
                    "source": self.SOURCE_NAME,
                    "external_id": ext_id,
                    "record_type": "CONTRACT",
                    "identifier": plate or contract_num,
                    "title": f"Tender shartnomasi #{contract_num}",
                    "status": item.get("status") or "ACTIVE",
                    "starts_at": item.get("date"),
                    "ends_at": item.get("exp_date"),
                    "amount": 0.0,
                    "parties": {
                        "company_name": (item.get("user") or {}).get("company_name"),
                        "inn": (item.get("user") or {}).get("inn"),
                    },
                    "raw_data": item,
                    "synced_at": datetime.now(timezone.utc).isoformat(),
                })

            elif api_type == "CERTIFICATE":
                cert_num = f"{item.get('seria', '')} {item.get('number', '')}".strip()
                ext_id = f"etender_cert_{item.get('id') or cert_num}"
                car = item.get("car") or {}
                plate = car.get("auto_number") or ""

                normalized.append({
                    "source": self.SOURCE_NAME,
                    "external_id": ext_id,
                    "record_type": "CERTIFICATE",
                    "identifier": plate or cert_num,
                    "title": f"Guvohnoma {cert_num}",
                    "status": item.get("status") or "ACTIVE",
                    "starts_at": item.get("created_at"),
                    "ends_at": item.get("exp_date"),
                    "amount": 0.0,
                    "parties": {"company_name": item.get("company_name")},
                    "raw_data": item,
                    "synced_at": datetime.now(timezone.utc).isoformat(),
                })

        return normalized

