import json
from pathlib import Path
from collectors.site2 import Site2Collector


def main():
    print("=" * 60)
    print(" Sayt 2 (bm.dtransport.uz) Collector Sinovi")
    print("=" * 60)

    collector = Site2Collector()
    records = collector.run()

    print(f"\n[V] Muvaffaqiyatli! Jami normalizatsiya qilingan yozuvlar: {len(records)}\n")
    for i, rec in enumerate(records[:3], 1):
        print(f"[{i}] {rec['record_type']} | {rec['identifier']} | {rec['title']}")

    output_file = Path("test_output_site2.json")
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)
    print(f"\n[V] Yozuvlar '{output_file.name}' fayliga saqlandi.")


if __name__ == "__main__":
    main()

