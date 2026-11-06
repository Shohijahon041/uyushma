# Yagona Transport & Ijara Portali (Collector Service)

Ushbu servis 3 ta mustaqil davlat axborot tizimlaridan shaxsiy hisob orqali ma'lumotlarni yig'ib, PostgreSQL ma'lumotlar bazasiga jamlaydi va yagona FastAPI Dashboard orqali namoyish qiladi.

---

## 1. Integratsiya qilingan manbalar

1. **Sayt 1 (`e-tender.uztrans.uz`)**: OneID orqali avtomatik kirish. Tender shartnomalari, arizalar, guvohnomalar va avtomobillar.
2. **Sayt 2 (`bm.dtransport.uz`)**: OneID SSO orqali avtomatik kirish. Korxona yo'nalishlari, avtobuslar va biriktirilgan haydovchilar.
3. **Sayt 3 (`ijara.soliq.uz`)**: E-IMZO (ECP) orqali interaktiv kirib, persistent brauzer profilini saqlash. Avtomobil ijara shartnomalari, to'lovlar va ijarachilar.

---

## 2. Loyiha strukturasi

```text
collector_service/
├── config/
│   ├── settings.py           # .env konfiguratsiyasi
│   └── logger.py             # Loglash tizimi
├── database/
│   ├── connection.py         # PostgreSQL ulanishi va sessiyalar
│   ├── models.py             # UnifiedRecord va SyncLog modellari
│   └── repository.py         # ON CONFLICT DO UPDATE (Upsert) va querylar
├── collectors/
│   ├── base.py               # Asosiy BaseCollector va SessionExpiredError
│   ├── site1.py              # e-tender collector
│   ├── site2.py              # bm.dtransport collector
│   └── site3.py              # ijara.soliq collector
├── notifications/
│   └── telegram_bot.py       # Telegram ogohlantirish boti
├── scripts/
│   ├── login_ijara.py        # E-IMZO orqali 1 marta kirish skripti
│   ├── test_site1.py         # Sayt 1 ni alohida sinash
│   ├── test_site2.py         # Sayt 2 ni alohida sinash
│   ├── test_site3.py         # Sayt 3 ni alohida sinash
│   ├── test_telegram.py      # Telegram botni sinash
│   └── run_all.py            # Barcha 3 manbani yig'uvchi orkestrator
├── scheduler/
│   └── cron_jobs.py          # Har 30 daqiqada avtomatik sinxronizatsiya
├── api/
│   ├── auth.py               # HTTP Basic Auth
│   ├── routes.py             # REST API va Dashboard marshrutlari
│   ├── main.py               # FastAPI serveri
│   └── templates/
│       └── dashboard.html    # Tailwind CSS asosidagi yagona boshqaruv paneli
├── profiles/                 # E-IMZO brauzer profillari (git ignored)
├── state/                    # OneID sessiya kesh fayllari (git ignored)
├── requirements.txt
├── .env.example
└── .gitignore
```

---

## 3. O'rnatish va Ishga Tushirish

### 1-qadam: Virtual muhit va kutubxonalarni o'rnatish
```powershell
cd "d:\Uyushma Dastur\collector_service"
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
```

### 2-qadam: Sozlamalarni to'ldirish
```powershell
copy .env.example .env
```
`.env` faylini ochib, OneID login/parollaringiz, Telegram bot tokeni va PostgreSQL ulanish manzilini kiriting.

### 3-qadam: Sayt 3 (ijara.soliq.uz) ga E-IMZO bilan kirish
Kompyuteringizda **E-IMZO** dasturi ishlab turganiga ishonch hosil qiling va skriptni ishga tushiring:
```powershell
python -m scripts.login_ijara
```
*Ochilgan brauzerda E-IMZO bilan kiring va terminalda `Enter` bosing. Profil saqlanadi.*

### 4-qadam: Barcha manbalardan ma'lumotlarni yig'ish (Sinxronizatsiya)
```powershell
python -m scripts.run_all
```

### 5-qadam: Davriy rejalashtiruvchini (Scheduler) yoqish
Har 30 daqiqada fonda avtomatik ma'lumotlarni yangilab turishi uchun:
```powershell
python -m scheduler.cron_jobs
```

### 6-qadam: Yagona Dashboard saytini ochish
```powershell
python -m api.main
```
Brauzerda oching: **`http://localhost:8000`**
- **Login:** `admin` (yoki `.env` dagi `DASHBOARD_USERNAME`)
- **Parol:** `admin123` (yoki `.env` dagi `DASHBOARD_PASSWORD`)

