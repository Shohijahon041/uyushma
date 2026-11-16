"""
OneID Automated Token Daemon
Avtomatlashtirilgan OneID SSO kirish dvigateli (Playwright Headless).
e-tender.uztrans.uz va bm.dtransport.uz portallari uchun yangi tokenlarni avtomatik oladi.
"""

import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Dict, Optional, Tuple
import requests
from playwright.sync_api import sync_playwright

# Path sozlamalari
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(BASE_DIR))

try:
    from config.logger import logger
    from config.settings import settings
except ImportError:
    import logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger("oneid_daemon")
    class DummySettings:
        STATE_DIR = BASE_DIR / "state"
        HEADLESS = True
        RATE_LIMIT_DELAY = 1.0
    settings = DummySettings()


ONEID_SSO_CONFIGS = {
    "ETENDER": {
        "sso_url": "https://sso.egov.uz/sso/oauth/Authorization.do?response_type=one_code&client_id=e-tender_uztrans_uz&redirect_uri=https://e-tender.uztrans.uz&scope=e-tender_uztrans_uz&state=e-tender_uztrans_uz",
        "api_login_url": "https://e-tenderapi.uztrans.uz/api/oneid-login",
        "state_file": "state_1.json",
        "origin": "https://e-tender.uztrans.uz",
    },
    "AUTOPARK": {
        "sso_url": "https://sso.egov.uz/sso/oauth/Authorization.do?response_type=one_code&client_id=bm_dtransport_uz&redirect_uri=https://bm.dtransport.uz/login/oneid&scope=myportal&state=testState",
        "api_login_url": "https://bmapi.dtransport.uz/user-management/api/v1/user-profile/login-via-oneid/profiles",
        "state_file": "state_2.json",
        "origin": "https://bm.dtransport.uz",
    },
}


class OneIdTokenDaemon:
    def __init__(self, headless: bool = True):
        self.headless = headless
        self.state_dir = Path(settings.STATE_DIR)
        self.state_dir.mkdir(parents=True, exist_ok=True)

    def acquire_one_code(self, provider: str, username: str, password: str) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Playwright orqali sso.egov.uz ga kirib, one_code yoki code ni ushlab oladi.
        """
        cfg = ONEID_SSO_CONFIGS.get(provider.upper())
        if not cfg:
            return False, None, f"Noma'lum provayder: {provider}"

        sso_url = cfg["sso_url"]
        logger.info(f"[{provider}] OneID SSO ga kirish boshlanmoqda (user: {username})...")

        with sync_playwright() as p:
            launch_args = [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-blink-features=AutomationControlled",
            ]
            browser = p.chromium.launch(headless=self.headless, args=launch_args)
            context = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
                viewport={"width": 1280, "height": 800},
            )
            page = context.new_page()

            intercepted_code = None

            def on_frame_navigated(frame):
                nonlocal intercepted_code
                u = frame.url
                m = re.search(r"[?&](?:one_code|code)=([^&#\s]+)", u, re.I)
                if m:
                    intercepted_code = m.group(1).strip()
                    logger.info(f"[{provider}] SSO redirect orqali kod tutib olindi!")

            page.on("framenavigated", on_frame_navigated)

            try:
                page.goto(sso_url, wait_until="domcontentloaded", timeout=45000)
                if intercepted_code:
                    browser.close()
                    return True, intercepted_code, None

                # Input maydonlarini kutish
                page.wait_for_selector('input[name="login"], input[name="username"], input[type="text"]', timeout=20000)
                page.wait_for_timeout(1000)

                login_input = (
                    page.query_selector('input[name="login"]')
                    or page.query_selector('input[name="username"]')
                    or page.query_selector('input[placeholder*="Login"]')
                    or page.query_selector('input[type="text"]')
                )

                password_input = (
                    page.query_selector('input[name="password"]')
                    or page.query_selector('input[type="password"]')
                )

                if not login_input or not password_input:
                    # Sahifa allaqachon avtorizatsiyalangan bo'lishi mumkin
                    if intercepted_code:
                        browser.close()
                        return True, intercepted_code, None
                    browser.close()
                    return False, None, "Login/parol maydonlari topilmadi"

                login_input.fill(username)
                password_input.fill(password)

                submit_btn = (
                    page.query_selector('button[type="submit"]')
                    or page.query_selector('button:has-text("Kirish")')
                    or page.query_selector('input[type="submit"]')
                )

                if submit_btn:
                    submit_btn.click()
                else:
                    password_input.press("Enter")

                # Redirect yoki SMS kutish (15 soniya)
                for _ in range(30):
                    page.wait_for_timeout(500)
                    if intercepted_code:
                        browser.close()
                        return True, intercepted_code, None

                    cur_url = page.url
                    m = re.search(r"[?&](?:one_code|code)=([^&#\s]+)", cur_url, re.I)
                    if m:
                        intercepted_code = m.group(1).strip()
                        browser.close()
                        return True, intercepted_code, None

                    # SMS tekshiruvi
                    body_text = page.inner_text("body") or ""
                    if "SMS" in body_text or "kod yuborildi" in body_text or "Tasdiqlash kodi" in body_text:
                        browser.close()
                        return False, None, "REQUIRES_SMS: OneID SMS tasdiqlash kodini talab qildi"

                    # Xatolik xabarlari
                    alerts = page.query_selector_all('.MuiAlert-message, [role="alert"], .error, .toast')
                    if alerts:
                        err_text = alerts[0].inner_text().strip()
                        if err_text:
                            browser.close()
                            return False, None, f"OneID xatosi: {err_text}"

                browser.close()
                return False, None, "OneID javob kutish vaqti tugadi (Timeout)"

            except Exception as e:
                browser.close()
                return False, None, f"Playwright xatosi: {str(e)}"

    def exchange_code_for_token(self, provider: str, code: str) -> Tuple[bool, Optional[str], Optional[dict]]:
        """
        Olingan one_code orqali tegishli portal API dan Bearer JWT tokenni oladi.
        """
        cfg = ONEID_SSO_CONFIGS.get(provider.upper())
        if not cfg:
            return False, None, {"error": "Invalid provider"}

        prov = provider.upper()
        if prov == "ETENDER":
            try:
                res = requests.post(
                    cfg["api_login_url"],
                    json={"code": code, "state": "e-tender_uztrans_uz"},
                    headers={"Content-Type": "application/json"},
                    timeout=25,
                )
                data = res.json()
                token = data.get("token") or (data.get("data") or {}).get("token") or (data.get("result") or {}).get("token")
                if token:
                    clean = token.replace("Bearer ", "").strip()
                    self._save_state(prov, clean)
                    return True, clean, data
                return False, None, data
            except Exception as e:
                return False, None, {"error": str(e)}

        elif prov == "AUTOPARK":
            try:
                url = f"{cfg['api_login_url']}?code={code}"
                res = requests.post(url, headers={"Content-Type": "application/json"}, timeout=25)
                data = res.json()
                token_data = (data.get("data") or {}).get("token") or {}
                token = token_data.get("access_token")
                refresh_token = token_data.get("refresh_token")
                profiles = (data.get("data") or {}).get("profiles") or []

                if token and profiles:
                    profile_id = profiles[0].get("id")
                    if profile_id:
                        switch_url = f"https://bmapi.dtransport.uz/user-management/api/v1/user-profile/login-via-oneid/profile/{profile_id}?code={code}"
                        sw_res = requests.post(switch_url, headers={"Content-Type": "application/json"}, timeout=25)
                        sw_data = sw_res.json()
                        sw_token = (sw_data.get("data") or {}).get("token") or (sw_data.get("data") or {}).get("access_token")
                        if sw_token:
                            token = sw_token

                if token:
                    clean = token.replace("Bearer ", "").strip()
                    self._save_state(prov, clean, refresh_token=refresh_token)
                    return True, clean, {"token": clean, "refreshToken": refresh_token}
                return False, None, data
            except Exception as e:
                return False, None, {"error": str(e)}

        return False, None, {"error": "Unsupported provider"}

    def _save_state(self, provider: str, token: str, refresh_token: Optional[str] = None):
        """Playwright storage_state faylini yangilaydi."""
        cfg = ONEID_SSO_CONFIGS.get(provider.upper())
        if not cfg:
            return
        state_file = self.state_dir / cfg["state_file"]
        state_data = {
            "cookies": [],
            "origins": [
                {
                    "origin": cfg["origin"],
                    "localStorage": [
                        {"name": "token", "value": token},
                        {"name": "access_token", "value": token},
                    ],
                }
            ],
        }
        if refresh_token:
            state_data["origins"][0]["localStorage"].append({"name": "refresh_token", "value": refresh_token})

        with open(state_file, "w", encoding="utf-8") as f:
            json.dump(state_data, f, indent=2)
        logger.info(f"[{provider}] Sessiya state fayli yangilandi: {state_file}")


def auto_renew_oneid(provider: str, username: str, password: str) -> Tuple[bool, Optional[str], Optional[str]]:
    daemon = OneIdTokenDaemon(headless=True)
    ok, code, err = daemon.acquire_one_code(provider, username, password)
    if not ok or not code:
        return False, None, err
    success, token, data = daemon.exchange_code_for_token(provider, code)
    if not success or not token:
        return False, None, f"Token exchange failed: {data}"
    return True, token, None


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Foydalanish: python oneid_token_daemon.py <ETENDER|AUTOPARK> <username> <password>")
        sys.exit(1)
    prov = sys.argv[1]
    u = sys.argv[2]
    pw = sys.argv[3]
    ok, tok, error = auto_renew_oneid(prov, u, pw)
    if ok:
        print(f"[SUCCESS] Yangi token olindi: {tok[:30]}...")
    else:
        print(f"[FAILED] Xatolik: {error}")
