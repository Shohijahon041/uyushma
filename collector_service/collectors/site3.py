from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from playwright.sync_api import sync_playwright

from collectors.base import BaseCollector, SessionExpiredError
from config.logger import logger
from config.settings import settings


class Site3Collector(BaseCollector):
    SOURCE_NAME = "ijara_soliq"
    BASE_URL = "https://ijara.soliq.uz"
    API_CONTRACTS_PATH = "/api/transport-rent/client/transport-rent/contract/get-list/by-params"

    def __init__(self):
        super().__init__()
        self.profile_dir = Path(settings.PROFILES_DIR) / "ijara_profile"

    def _ensure_profile_exists(self):
        if not self.profile_dir.exists() or not any(self.profile_dir.iterdir()):
            raise SessionExpiredError(
                "ijara.soliq.uz profili topilmadi! Iltimos, avval login skriptini "
                "ishga tushiring: python -m scripts.login_ijara"
            )

    def fetch(self) -> List[Dict[str, Any]]:
        self._ensure_profile_exists()
        all_contracts: List[Dict[str, Any]] = []

        with sync_playwright() as p:
            launch_args = [
                "--disable-blink-features=AutomationControlled",
                "--ignore-certificate-errors",
                "--allow-insecure-localhost",
            ]

            context = None
            try:
                context = p.chromium.launch_persistent_context(
                    user_data_dir=str(self.profile_dir.resolve()),
                    headless=settings.HEADLESS,
                    ignore_https_errors=True,
                    args=launch_args,
                )
            except Exception as err:
                logger.error(f"Ijara profilini yuklashda xatolik: {err}")
                raise SessionExpiredError(f"Brauzer profilini ochib bo'lmadi: {err}")

            page = context.pages[0] if context.pages else context.new_page()

            try:
                # 1. Sessiya holatini tekshirish
                test_url = f"{self.BASE_URL}/car/renting/list?myRentType=1&statusGroup=1"
                logger.info(f"[{self.SOURCE_NAME}] Sessiya tekshirilmoqda: {test_url}")
                page.goto(test_url, wait_until="domcontentloaded", timeout=45000)
                self.sleep_rate_limit()

                if "login" in page.url.lower():
                    logger.warning(f"[{self.SOURCE_NAME}] Sessiya muddati tugagan (login sahifasiga yo'naltirildi).")
                    raise SessionExpiredError("ijara.soliq.uz sessiyasi tugadi, qayta kiring (scripts/login_ijara.py)")

                # Tokenni olish
                auth_token = page.evaluate("""() => {
                    try {
                        return localStorage.getItem('token') 
                            || localStorage.getItem('access_token') 
                            || null;
                    } catch (e) {
                        return null;
                    }
                }""")

                rent_types = [1, 2]
                status_groups = ["1", "2"]

                headers = {}
                if auth_token:
                    clean_token = auth_token.replace("Bearer ", "").strip()
                    headers["Authorization"] = f"Bearer {clean_token}"

                for rent_type in rent_types:
                    for status_group in status_groups:
                        page_num = 0
                        max_pages = 30

                        while page_num < max_pages:
                            api_url = (
                                f"{self.BASE_URL}{self.API_CONTRACTS_PATH}?"
                                f"page={page_num}&size=50&limit=50&myRentType={rent_type}&statusGroup={status_group}"
                            )

                            logger.info(
                                f"[{self.SOURCE_NAME}] So'rov: rentType={rent_type}, status={status_group}, page={page_num}"
                            )

                            try:
                                response = page.request.get(api_url, headers=headers, timeout=30000)

                                if response.status in (401, 403):
                                    raise SessionExpiredError(
                                        f"ijara.soliq.uz avtorizatsiya xatosi ({response.status}). Qayta kiring!"
                                    )

                                if response.status != 200:
                                    logger.warning(
                                        f"[{self.SOURCE_NAME}] API {response.status} qaytardi: {response.text()[:200]}"
                                    )
                                    break

                                payload = response.json()
                                items = self._extract_items_list(payload)

                                if not items:
                                    break

                                for item in items:
                                    item["_rent_type"] = rent_type
                                    item["_status_group"] = status_group
                                    all_contracts.append(item)

                                if len(items) < 50:
                                    break

                                page_num += 1
                                self.sleep_rate_limit()

                            except SessionExpiredError:
                                raise
                            except Exception as req_err:
                                logger.error(f"[{self.SOURCE_NAME}] Sahifa {page_num} da xatolik: {req_err}")
                                break

            finally:
                context.close()

        logger.info(f"[{self.SOURCE_NAME}] Jami {len(all_contracts)} ta shartnoma yuklab olindi.")
        return all_contracts

    @staticmethod
    def _extract_items_list(payload: Any) -> List[Dict[str, Any]]:
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict):
            for key in ["data", "result", "content", "items"]:
                val = payload.get(key)
                if isinstance(val, list):
                    return val
                if isinstance(val, dict):
                    inner = val.get("content") or val.get("items") or val.get("data")
                    if isinstance(inner, list):
                        return inner
        return []

    def normalize(self, raw_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        normalized_records = []
        seen_ids = set()

        for item in raw_items:
            contract_id = (
                item.get("id")
                or item.get("contract_id")
                or item.get("contractId")
            )
            if not contract_id:
                continue

            external_id = f"ijara_contract_{contract_id}"
            if external_id in seen_ids:
                continue
            seen_ids.add(external_id)

            plate_number = (
                item.get("vehicleNumber")
                or item.get("vehicle_number")
                or item.get("car_number")
                or item.get("carNumber")
                or item.get("plateNumber")
                or item.get("plate_number")
                or item.get("govNumber")
                or ""
            )
            if isinstance(plate_number, str):
                plate_number = plate_number.replace(" ", "").upper()

            contract_number = (
                item.get("contract_number")
                or item.get("contractNumber")
                or item.get("number")
                or str(contract_id)
            )
            title = f"Ijara shartnomasi: {plate_number}" if plate_number else f"Ijara shartnomasi #{contract_number}"

            raw_state = item.get("rentState") or item.get("status") or item.get("status_name")
            status = "ACTIVE" if raw_state in (1, 10, "1", "10", "ACTIVE") else str(raw_state or "UNKNOWN")

            starts_at = self._parse_date(
                item.get("rentStartDate")
                or item.get("start_date")
                or item.get("startDate")
                or item.get("from_date")
            )
            ends_at = self._parse_date(
                item.get("rentEndDate")
                or item.get("end_date")
                or item.get("endDate")
                or item.get("to_date")
            )

            raw_amount = (
                item.get("rentMonthlyRate")
                or item.get("rent_monthly_rate")
                or item.get("rentSum")
                or item.get("rent_amount")
                or item.get("rentAmount")
                or item.get("monthly_amount")
                or 0
            )
            try:
                amount = float(raw_amount)
            except (ValueError, TypeError):
                amount = 0.0

            # Ijaraga beruvchi (Lessor / fromName)
            lessor_dict = item.get("lessor") if isinstance(item.get("lessor"), dict) else {}
            lessor_name = (
                item.get("fromName")
                or item.get("lessor_name")
                or item.get("lessorName")
                or lessor_dict.get("name")
            )
            lessor_id = item.get("fromPersonId") or item.get("lessor_pinfl")
            lessor_phone = item.get("fromPhone") or item.get("lessor_phone")

            # Ijaraga oluvchi / Haydovchi (Lessee / toName)
            lessee_dict = item.get("lessee") if isinstance(item.get("lessee"), dict) else {}
            lessee_name = (
                item.get("toName")
                or item.get("toDirectorName")
                or item.get("lessee_name")
                or item.get("lesseeName")
                or item.get("driver_name")
                or item.get("client_name")
                or lessee_dict.get("name")
            )
            lessee_pinfl = (
                item.get("toPersonId")
                or item.get("lessee_pinfl")
                or item.get("lesseePinfl")
                or lessee_dict.get("pinfl")
            )
            lessee_phone = (
                item.get("toPhone")
                or item.get("lessee_phone")
                or item.get("lesseePhone")
                or lessee_dict.get("phone")
            )
            lessee_license = (
                item.get("toLicenseNumber")
                or item.get("lessee_license")
                or item.get("lesseeLicense")
                or item.get("license_number")
            )

            parties = {
                "lessor_name": lessor_name,
                "lessor_id": lessor_id,
                "lessor_phone": lessor_phone,
                "lessee_name": lessee_name,
                "lessee_pinfl": lessee_pinfl,
                "lessee_phone": lessee_phone,
                "lessee_license": lessee_license,
            }

            start_dmy = starts_at.strftime("%d.%m.%Y") if starts_at else ""
            end_dmy = ends_at.strftime("%d.%m.%Y") if ends_at else ""
            contract_view_url = (
                f"https://ijara.soliq.uz/car/contract-view/{contract_id}/{start_dmy}/{end_dmy}"
                if start_dmy and end_dmy
                else f"https://ijara.soliq.uz/car/renting/list?myRentType=1&statusGroup=1"
            )

            raw_data = {
                **item,
                "contractViewUrl": contract_view_url,
            }

            normalized_records.append({
                "source": self.SOURCE_NAME,
                "external_id": external_id,
                "record_type": "RENT_CONTRACT",
                "identifier": plate_number,
                "title": title,
                "status": status,
                "starts_at": starts_at.isoformat() if starts_at else None,
                "ends_at": ends_at.isoformat() if ends_at else None,
                "amount": amount,
                "parties": parties,
                "raw_data": raw_data,
                "synced_at": datetime.now(timezone.utc).isoformat(),
            })

        return normalized_records

    @staticmethod
    def _parse_date(date_val: Any) -> Optional[datetime]:
        if not date_val:
            return None
        if isinstance(date_val, (int, float)):
            if date_val > 1e11:
                date_val /= 1000.0
            return datetime.fromtimestamp(date_val, tz=timezone.utc)
        if isinstance(date_val, str):
            clean_str = date_val.strip()
            for fmt in (
                "%Y-%m-%dT%H:%M:%S.%fZ",
                "%Y-%m-%dT%H:%M:%SZ",
                "%Y-%m-%d %H:%M:%S",
                "%Y-%m-%d",
                "%d.%m.%Y",
                "%d/%m/%Y",
            ):
                try:
                    return datetime.strptime(clean_str, fmt).replace(tzinfo=timezone.utc)
                except ValueError:
                    continue
        return None

