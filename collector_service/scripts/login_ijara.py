from pathlib import Path
import sys
from playwright.sync_api import sync_playwright

from config.logger import logger
from config.settings import settings


def launch_ijara_login():
    profile_dir = Path(settings.PROFILES_DIR) / "ijara_profile"
    profile_dir.mkdir(parents=True, exist_ok=True)

    target_login_url = "https://ijara.soliq.uz/car/renting/list?myRentType=1&statusGroup=1"

    print("=" * 70)
    print(" ijara.soliq.uz — E-IMZO orqali kirish yordamchisi")
    print("=" * 70)
    print(f"[*] Profil papkasi: {profile_dir.resolve()}")
    print("[*] Brauzer ochilmoqda...")
    print("[!] DIQQAT: Kompyuteringizda E-IMZO (E-IMZO moduli) dasturi ishlayotgan bo'lishi kerak.")
    print("=" * 70)

    with sync_playwright() as p:
        launch_args = [
            "--disable-blink-features=AutomationControlled",
            "--ignore-certificate-errors",
            "--allow-insecure-localhost",
        ]

        context = None
        try:
            context = p.chromium.launch_persistent_context(
                user_data_dir=str(profile_dir.resolve()),
                headless=False,
                channel="chrome",
                ignore_https_errors=True,
                args=launch_args,
                viewport={"width": 1280, "height": 800},
            )
            logger.info("Google Chrome orqali ochildi.")
        except Exception:
            logger.info("Chrome topilmadi, standart Chromium orqali ochilmoqda...")
            context = p.chromium.launch_persistent_context(
                user_data_dir=str(profile_dir.resolve()),
                headless=False,
                ignore_https_errors=True,
                args=launch_args,
                viewport={"width": 1280, "height": 800},
            )

        page = context.pages[0] if context.pages else context.new_page()

        try:
            logger.info(f"Sahifaga o'tilmoqda: {target_login_url}")
            page.goto(target_login_url, wait_until="domcontentloaded", timeout=60000)

            print("\n" + "#" * 70)
            print(" QADAMLAR:")
            print(" 1. Ochilgan brauzer oynasida 'E-IMZO' tugmasini bosing.")
            print(" 2. Kalitingizni tanlang va E-IMZO oynasida parolni kiriting.")
            print(" 3. Shaxsiy kabinetingizga muvaffaqiyatli kirgach:")
            print("    SHU TERMINALGA QAYTING VA [ENTER] TUGMASINI BOSING.")
            print("#" * 70 + "\n")

            input(">>> Tizimga muvaffaqiyatli kirganingizdan so'ng ENTER bosing: ")

            try:
                active_pages = [p for p in context.pages if not p.is_closed()]
                if active_pages:
                    active_page = active_pages[0]
                    current_url = active_page.url
                    logger.info(f"Joriy sahifa URL: {current_url}")
                    if "login" not in current_url.lower():
                        print("\n[V] MUVAFFAQISAT: Tizimga kirish tasdiqlandi!")
                    else:
                        print("\n[*] Profil ma'lumotlari saqlandi.")
                else:
                    print("\n[*] Brauzer yopildi, profil ma'lumotlari to'liq saqlandi.")
            except Exception as eval_err:
                logger.debug(f"Sessiyani tekshirishda ogohlantirish: {eval_err}")
                print("\n[V] Profil muvaffaqiyatli saqlandi.")

            print(f"[V] Brauzer profili tayyor: {profile_dir.resolve()}")

        except Exception as e:
            logger.error(f"Kirish jarayonida xatolik: {e}")
        finally:
            try:
                context.close()
            except Exception:
                pass
            print("[*] Brauzer yopildi. Profil saqlandi.\n")


if __name__ == "__main__":
    launch_ijara_login()

