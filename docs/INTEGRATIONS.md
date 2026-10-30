# Tashqi tizimlar integratsiyasi (e-tender va avtopark)

Ushbu hujjat One ID orqali ochiladigan ikki tashqi tizimdan ma'lumotlarni
"Uyushmachilar" platformasiga sinxronlashni tavsiflaydi. Integratsiya har bir
kompaniya (tenant) uchun alohida ishlaydi: token shifrlangan holda saqlanadi,
ma'lumotlar RLS bilan ajratilgan jadvallarga tushadi.

## 1. Sahifalar va ulardan olinadigan ma'lumotlar

| Sahifa (brauzerda) | Tizim API manzili | Olinadigan ma'lumot | Loyihadagi joy |
| --- | --- | --- | --- |
| `bm.dtransport.uz/sc/autopark/autopark-list` | `GET https://bmapi.dtransport.uz/non-brutto-management/api/v1/vehicles` | Avtoparkdagi barcha avtomobillar: davlat raqami, garaj raqami, VIN, GPS IMEI, tashkilot, yo'nalish nomi va raqami, avtomobil klassi/modeli, haydovchilar | `ExternalVehicle` (provider `AUTOPARK`) → **Tashqi reyestr → Avtopark** |
| `e-tender.uztrans.uz/crm/profile` | `GET https://e-tenderapi.uztrans.uz/api/profile` | Firma nomi (token tekshiruvi uchun ham ishlatiladi) | Ulanish sozlamalarida "Tashkilot" sifatida; avtomobillarga `organizationName` sifatida yoziladi |
| `e-tender.uztrans.uz/crm/myappeal` | `POST /api/contract/user/appeal?page=N` | Shartnoma arizalari: raqam, yo'nalish, holat, sana | `ExternalRecord` (kind `CONTRACT_APPLICATION`) |
| `e-tender.uztrans.uz/crm/myappeal/edit/47804` | ariza javobidagi `cars` / `new_cars` | Shartnomaga biriktirilgan avtomobillar (davlat raqami, model, VIN, yo'nalish) | `ExternalVehicle` (provider `ETENDER`) — `get-cars` va litsenziya hisoboti bilan davlat raqami bo'yicha birlashtiriladi |
| `e-tender.uztrans.uz/crm/reports/car-report` | `POST /api/report/car-report` (filtr tanasi bilan, javob `result.result.data`) | Litsenziya: raqami, boshlanish/tugash sanasi, yo'nalish, model, texpasport | `ExternalVehicle.licenseNumber`, `licenseExpiresAt`, `routeName`, `routeNumber`, `vehicleModel` |
| `e-tender.uztrans.uz/crm/usercertificate` | `POST /api/certificate/user?page=N` | Guvohnomalar: seriya + raqam, holat, berilgan va tugash sanasi, avtomobil | `ExternalRecord` (kind `CERTIFICATE`) + `ExternalVehicle` |
| `e-tender.uztrans.uz/crm/user/application` | `POST /api/application/user` | Tenderda yutilgan/ko'rilayotgan yo'nalish arizalari va holatlari | `ExternalRecord` (kind `TENDER_APPLICATION`) |
| `e-tender.uztrans.uz/crm/mycontract` | `POST /api/contract/user?page=N` | Shartnomalar: raqam, yo'nalish, holat, boshlanish/tugash sanalari | `ExternalRecord` (kind `CONTRACT`) |
| `e-tender.uztrans.uz` (avtopark ro'yxati) | `GET /api/user/get-cars` | Barcha avtomobillar: davlat raqami, marka, yili, texnika turi, litsenziya kartasi | `ExternalVehicle` (provider `ETENDER`) |

Javoblar Laravel paginatori (`data`, `last_page`, `total`) bilan sahifalanadi —
konnektor barcha sahifalarni aylanib chiqadi (guvohnomalar ~40 sahifa).
`{ error: true, message }` ko'rinishidagi HTTP 200 javoblar jimgina nolga
aylanmaydi, sinxronlash tarixida ogohlantirish sifatida ko'rsatiladi.

`raw` (JSONB) maydonida faqat biznes maydonlari saqlanadi: provayderning
foydalanuvchi jadvali (email, telefon, bank hisobi, manzil) va ortiqcha
bog'lanishlar olib tashlanadi.

## 2. Loyihaga nima qo'shildi

**Ma'lumotlar bazasi** (`20261030235500_external_registry` migratsiyasi):

- `ExternalConnection` — tenant + provayder uchun bitta ulanish: bazaviy manzil,
  shifrlangan token, shifrlangan login/parol (`20261031010000_external_credentials`),
  holat (`ACTIVE` / `INVALID` / `DISABLED`), oxirgi sinxronlash, oxirgi avtomatik
  kirish va oxirgi xato.
- `ExternalSyncRun` — har bir sinxronlash tarixi: holat, natija soni, xato.
- `ExternalVehicle` — tashqi avtopark/reyestr avtomobillari; loyihadagi
  `Vehicle` bilan avtomatik bog'lanadi (raqam bo'yicha moslashtiriladi, topilmasa
  yangi `Vehicle` yaratiladi).
- `ExternalRecord` — arizalar, shartnomalar, guvohnomalar, tender arizalari.
- Barcha to'rt jadvalda RLS yoqilgan va majburlangan; `uyushma_app` roli uchun
  `DELETE` taqiqlangan.

**API** (`apps/api/src/modules/external`):

- `GET /api/v1/settings/integrations` — ulanishlar ro'yxati (tokensiz).
- `PUT /api/v1/settings/integrations/:provider` — login/parol yoki tokenni
  tekshirib saqlash (`ETENDER` yoki `AUTOPARK`). Login berilganda token darhol
  olinadi; login, parol va token AES-256-GCM bilan shifrlanadi.
- `POST /api/v1/settings/integrations/:provider/sync` — sinxronlashni navbatga
  qo'yish; `POST .../disable` — o'chirish; `GET .../runs` — tarix.
- `GET /api/v1/registry/vehicles` — avtomobillar (provayder, qidiruv, limit).
- `GET /api/v1/registry/records?kind=...` — yozuvlar turlari bo'yicha.
- `POST /api/v1/internal/external/sync` va `sync-all` — faqat service key bilan
  (worker chaqiradi).
- Qo'shimcha himoya: sozlamalar faqat `OWNER`/`ADMIN`, so'rovlar throttling bilan
  cheklangan; 401/403 kelsa ulanish `INVALID` deb belgilanadi.

**Worker** (`apps/worker`): `external-sync` navbati va har 6 soatda
(`Asia/Tashkent`) `external.sync-all` jobi. Qo'lda sinxronlash ham shu navbatdan
o'tadi, shuning uchun API javobi tez qaytadi.

**Veb** (`apps/web`):

- **Sozlamalar → Tashqi tizimlar**: har bir provayder uchun login/parol (asosiy)
  yoki token (zaxira) rejimi, "Hozir sinxronlash", "Ulanishni o'chirish", oxirgi
  avtomatik kirish, tashqi tizimdagi tashkilot nomi, sinxronlash/xato va tarix.
- **Tashqi reyestr** sahifasi (chap menyu): Avtopark, Shartnoma arizalari,
  Shartnomalar, Guvohnomalar, Tender arizalari tablari; avtoparkda qidiruv va
  loyihadagi avtomobil bilan moslik belgisi.

## 2.1 Sinxronlangan ma'lumotni barcha bo'limlarga moslashtirish

Sinxronlash faqat "Tashqi reyestr" bilan cheklanmaydi — har bir yurgizishda
ma'lumot loyihaning o'z bo'limlariga ham yoziladi:

- **Avtomobillar** — tashqi avtomobil davlat raqami bo'yicha mavjud `Vehicle`
  bilan bog'lanadi. Topilmasa, kompaniya egasi (OWNER/ADMIN foydalanuvchi) nomidan
  yangi `Vehicle` yaratiladi: raqam, model (bo'lmasa "Ko'rsatilmagan"), sig'im
  (ma'lum bo'lsa o'rindiq soni). Shu sababli avtomobillar jadvali, shartnoma
  tanlovi va boshqaruv paneli hisoblari haqiqiy avtoparkni ko'rsatadi.
  Import qilingan avtomobillar obuna rejasidagi `maxVehicles` limitiga
  kirmaydi — limit faqat qo'lda boshqariladigan avtomobillarga tegishli.
- **Yo'nalishlar** — tashqi avtomobillarning yo'nalish nomlari va shartnoma/
  ariza javoblaridagi `directions` (nomi + masofa) asosida `Route` yaratiladi:
  nom, "Qayerdan/Qayerga" va masofa. Masofa tashqi tizimda bo'lmasa `0`
  qo'yiladi va yo'nalishlar sahifasida shu qator uchun kiritish maydoni
  ko'rsatiladi (tarif hisob-kitobi 0 km bilan ishlamasligi uchun).
- **Shartnomalar** — e-tender shartnomalari loyihaning ichki ijara/xizmat
  shartnomalari modeliga majburan aylantirilmaydi (ular boshqa huquqiy ma'no va
  to'lovga ega). Ular shartnomalar sahifasida alohida "e-tender shartnomalari"
  jadvalida faqat ko'rish uchun ko'rsatiladi.
- **Boshqaruv paneli** — "e-tender ma'lumotlari" kartasi: avtomobillar,
  shartnomalar, guvohnomalar, arizalar va tender arizalari soni, oxirgi
  sinxronlash vaqti hamda 30 kun ichida tugaydigan guvohnomalar.
- **Sozlamalar** — ulanish kartasida tashqi tizimdagi tashkilot nomi ko'rsatiladi.

Sinxronlash natijasi (`ExternalSyncRun.counts`) endi `vehicles`, `created`,
`matched`, `routes`, `records` va `warnings` maydonlarini qaytaradi.

## 3. Ulanishni sozlash (login va parol → avtomatik token)

**Asosiy usul — login va parol.** Foydalanuvchi One ID (e-tender uchun INN /
JShShIR) yoki BM logini va parolini bir marta kiritadi. Platforma ularni
AES-256-GCM bilan shifrlab saqlaydi va har bir sinxronlash oldidan o'zi qayta
kiradi:

- **e-tender**: `POST https://e-tenderapi.uztrans.uz/api/login` —
  `{ "inn", "password", "ip" }` → `{ "success": true, "token": "..." }`.
  `ip` ixtiyoriy; bo'sh bo'lsa tashqi tizim o'z jurnaliga yozadi.
- **bm.dtransport.uz**: `POST https://bmapi.dtransport.uz/user-management/api/v1/user-profile/login`
  — `{ "username", "password" }` → `access_token` + `refresh_token`.
- Har sinxronlash (6 soatda) yangi token oladi, shuning uchun token muddati
  tugashi sinxronlashni to'xtatmaydi. Login rad etilsa, sabab (masalan
  "Вход с логином и паролем заблокирован") sozlamalarda va sinxronlash
  tarixida ko'rsatiladi.
- Vaqtinchalik xato tufayli ulanish `INVALID` bo'lsa ham, login rejimidagi
  ulanish keyingi 6 soatlik sinxronlashda qayta urinib ko'radi va o'zi
  tiklanishi mumkin (navbatda 3 marta qayta urinish ham bor).
- Login/parol noto'g'ri bo'lsa, ulanish saqlanmaydi — xato darhol ko'rsatiladi.

**Zaxira usul — Bearer token.** Agar tashqi tizim parol bilan kirishni
bloklagan bo'lsa (e-tender ba'zi kompaniyalar uchun shunday qiladi), tokenni
qo'lda olish mumkin:

1. Brauzerda `https://e-tender.uztrans.uz/crm/profile` (yoki
   `https://bm.dtransport.uz/sc/autopark/autopark-list`) sahifasiga kiring.
2. `F12` → **Network** → sahifani yangilang (`Ctrl+R`).
3. `e-tenderapi.uztrans.uz` (yoki `bmapi.dtransport.uz`) ga ketgan so'rovni
   tanlang → **Headers** → `Authorization: Bearer ...` qiymatini nusxalang.
4. Sozlamalarda **Token** rejimini tanlab, tokenni kiriting va saqlang.

Token rejimida muddati tugagan token `INVALID` holatiga olib keladi — tokenni
yangilash kerak. Login rejimida esa bunday muammo yo'q.

### E-IMZO haqida

E-IMZO tashqi saytlarga **foydalanuvchi kompyuteridagi E-IMZO Desktop** va
mahalliy kalit orqali kiradi (imzo `localhost` agentida yaratiladi). Uni VDS
serverdan ishga tushirish mumkin emas va e-tender/BM API'larida imzoni qabul
qiladigan alohida endpoint yo'q — shuning uchun bu loyihada E-IMZO o'rniga
login/parol yoki token ishlatiladi. E-IMZO bilan kirish faqat tashqi tizim
egasi server uchun imzo qabul qiladigan API ochsa mumkin bo'ladi.

### One ID SSO (kelajakda)

Saytlar `sso.egov.uz` orqali `client_id=e-tender_uztrans_uz` /
`bm_dtransport_uz` bilan kiradi, ammo `redirect_uri` tashqi saytga qaytadi va
`code` faqat o'sha saytda bir marta ishlatiladi — platforma uni ushlab ololmaydi.
Buni to'liq avtomatlashtirish uchun tashqi tizim egasidan alohida OAuth client
(`redirect_uri` bizning domen) kerak bo'ladi.

### Endpointlarni sozlash

Manzillar ommaviy SPA kodidan olingan va tashqi tizim yangilanishida o'zgarishi
mumkin. Har bir ulanish uchun `config` maydoni orqali yo'llarni qayta yozish
mumkin (API orqali `PUT /settings/integrations/:provider`):

```json
{
  "credentials": {
    "username": "301234567",
    "password": "<parol>",
    "ip": "203.0.113.10"
  },
  "config": {
    "endpoints": { "applications": "/api/contract/user/appeal" },
    "reportBody": { "cstatus": "" }
  }
}
```

Token rejimi uchun `"credentials"` o'rniga `"token": "<Bearer token>"` yuboriladi.
`endpoints.login` orqali kirish yo'lini ham qayta yozish mumkin (masalan tashqi
tizim endpointni ko'chirsa). `AUTOPARK` uchun `registryPrefix` (masalan brutto
ro'yxati uchun `/brutto-management/api/v1`) yoki `endpoints.vehicles`
ishlatiladi. `reportBody` litsenziya hisoboti filtriga qo'shiladi (masalan
`auto_number` yoki `cstatus` bo'yicha toraytirish uchun).

## 4. Xavfsizlik

- Tokenlar va login/parollar faqat shifrlangan (`v1.iv.tag.ciphertext`) holda
  saqlanadi, API javobida va loglarda ko'rinmaydi. "Ulanishni o'chirish"
  login/parolni darhol o'chiradi.
- Parol bilan kirish uchun alohida (faqat integratsiya uchun) hisob ochish
  tavsiya etiladi; kompaniya egasining shaxsiy One ID parolini saqlamang.
- Har bir tenant faqat o'z ulanishi va yozuvlarini ko'radi (PostgreSQL RLS +
  `withTenant` tranzaksiyasi).
- Sinxronlash fakti va ulanish o'zgarishlari audit jurnaliga yoziladi.
- Tashqi tizimga faqat chiquvchi HTTPS so'rovlar yuboriladi; kiruvchi webhook
  yo'q.

## 5. Ubuntu 24 / VDS'ga joylash

Talablar: Node.js 22+, PostgreSQL 16, Redis 7, ochiq chiquvchi HTTPS
(`e-tenderapi.uztrans.uz`, `bmapi.dtransport.uz`).

```bash
# 1) Kod va muhit
sudo apt update && sudo apt install -y nodejs npm postgresql redis-server
cd /opt/uyushma
cp .env.example .env        # DATABASE_URL, MIGRATE_DATABASE_URL, REDIS_URL,
                            # JWT kalitlari, ENCRYPTION_KEY (32 bayt base64)
npm ci
npm run db:generate

# 2) Migratsiyalar (RLS va tashqi reyestr jadvallari bilan)
npm run db:migrate
npm run db:seed             # ixtiyoriy: boshlang'ich ma'lumot

# 3) Yig'ish
npm run build

# 4) API, worker, bot, web — systemd yoki docker compose bilan
npm run start -w @uyushma/api       # :4000 (nginx/Caddy orqasida)
npm run start -w @uyushma/worker    # navbatlar + 6 soatlik sync
npm run start -w @uyushma/web       # :3000
```

Docker bilan xohlasangiz `docker compose --profile app up -d --build` ishlatiladi
(`docs/STAGING.md`ga qarang). Serverda vaqt mintaqasi muhim emas: sync jadvali
`Asia/Tashkent` bo'yicha belgilangan.

**Tekshirish:**

```bash
curl -fsS https://DOMAIN/api/v1/health/live
curl -fsS https://DOMAIN/api/v1/health/ready
# Worker logida: "external-registry-sync" scheduler ro'yxatga olinganini ko'ring
```

Birinchi sozlashdan keyin: **Sozlamalar → Tashqi tizimlar**da ikkala provayder
uchun login/parolni kiriting → "Hozir sinxronlash" → **Tashqi reyestr**
sahifasida ma'lumot paydo bo'lishini tekshiring.

## 6. Loyihada ilgari yo'q bo'lgan, endi qo'shilgan ma'lumotlar

- Avtoparkdagi **garaj raqami, GPS IMEI, yo'nalish varianti, avtomobil klassi va
  haydovchilar** — avval faqat davlat raqami/model/makonaviy sig'im bor edi.
- **Litsenziya raqami va amal qilish muddati** — muddati tugayotgan avtomobillarni
  oldindan ko'rish imkoniyati.
- **Shartnoma arizalari, guvohnomalar, tender arizalari va shartnoma holatlari**
  — ilgari faqat ichki shartnomalar mavjud edi, tashqi holat kuzatilmasdi.
- **Tashqi va ichki avtomobilni raqam bo'yicha avtomatik moslash** — qaysi
  avtomobil avtoparkda bor-u, loyihada yo'qligini ko'rish.
- **Sinxronlash tarixi va xatolar** — integratsiya sog'lig'ini kuzatish.

Hozircha qo'shilmagan (tashqi API'da tasdiqlanmagan): haydovchi pasport/guvohnoma
tafsilotlari, to'lovlar va yo'l varaqalari. Ular uchun endpointlar aniqlansa,
`config.endpoints` bilan qo'shish kifoya — sxema o'zgarishsiz qoladi.
