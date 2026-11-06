import json
from pathlib import Path
from collectors.base import SessionExpiredError
from collectors.site3 import Site3Collector
from config.settings import settings


def main():
    print("=" * 70)
    print(" Sayt 3 (ijara.soliq.uz) Collector Sinovi")
    print("=" * 70)

    profile_dir = Path(settings.PROFILES_DIR) / "ijara_profile"
    if not profile_dir.exists() or not any(profile_dir.iterdir()):
        print("\n[!] DIQQAT: 'profiles/ijara_profile' papkasi mavjud emas!")
        print("[!] Avval E-IMZO orqali kirish skriptini ishga tushiring:")
        print("    python -m scripts.login_ijara\n")
        return

    collector = Site3Collector()

    try:
        print("[*] Shartnomalar yig'ilmoqda...")
        records = collector.run()

        print(f"\n[V] MUVAFFAQISAT! Jami normalizatsiya qilingan yozuvlar soni: {len(records)}\n")
        print("-" * 70)
        for i, rec in enumerate(records[:3], 1):
            print(f"[{i}] external_id : {rec['external_id']}")
            print(f"    Davlat raqam: {rec['identifier']}")
            print(f"    Sarlavha    : {rec['title']}")
            print(f"    Holati      : {rec['status']}")
            print(f"    Oylik ijara : {rec['amount']:,.2f} so'm")
            print(f"    Ijarachi    : {rec['parties'].get('lessee_name')} ({rec['parties'].get('lessee_phone')})")
            print("-" * 70)

        output_file = Path("test_output_site3.json")
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(records, f, ensure_ascii=False, indent=2)
        print(f"\n[V] Yozuvlar '{output_file.name}' fayliga saqlandi.")

    except SessionExpiredError as e:
        print(f"\n[X] SESSIYA XATOSI: {e}")
        print("[*] Iltimos, qayta kiring: python -m scripts.login_ijara")
    except Exception as e:
        print(f"\n[X] KUTILMAGAN XATOLIK: {e}")


if __name__ == "__main__":
    main()

