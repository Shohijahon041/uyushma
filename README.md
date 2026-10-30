# Uyushmachilar

O'zbekistondagi transport uyushmalari uchun ko'p kompaniyali (multi-tenant) transport, shartnoma, yo'nalish, tarif, to'lov va moliyaviy boshqaruv platformasi.

> **Holat: Stage 1 — ishlaydigan foundation.** Asosiy tenant izolyatsiyasi, autentifikatsiya, shartnoma/tarif/to'lov oqimi, audit, obuna, worker, bot va web interfeys tayyor va testdan o'tgan. Hali production deploy qilinmagan. To'liq scope va cheklovlar uchun [Stage 1 hisoboti](docs/STAGE-1-REPORT.md) ga qarang.

## Nima bor

| Soha | Imkoniyat |
| --- | --- |
| Multi-tenancy | Har bir jadvalda `tenantId`, PostgreSQL RLS (FORCE), composite tenant FK, tenant-scoped transaction |
| Auth | Kompaniya kodi + email + parol, Argon2id, qisqa access JWT, rotating refresh token, reuse detection, httpOnly BFF cookie |
| RBAC | `OWNER`, `ADMIN`, `ACCOUNTANT`, `MANAGER` rollari bo'yicha endpoint himoyasi |
| Avtopark | Avtomobillar, egalari, holatlari, tarif/obuna limitlari |
| Yo'nalishlar | Cheklanmagan miqdorda yo'nalish, masofa (Decimal); yo'nalish oylik plani — o'z oylik to'lovi 0 bo'lgan avtomobillarga qo'llanadi (avtomobilning o'z to'lovi ustun); `/vehicles` sahifasida avtomobillar yo'nalish bo'yicha guruhlanadi va yo'nalish tanlanadi |
| Tariflar | `STANDARD`, `ROUTE`, `INDIVIDUAL`; `ADD` va `OVERRIDE` qoidalari; hisob faqat serverda va Decimal'da |
| Shartnomalar | `SELF_USE`, `LEASE`, `SERVICE`; qoralama → faol → bekor qilish; bitta avtomobil uchun bitta faol shartnoma (DB darajasida) |
| To'lovlar | Manual va automatic; `Idempotency-Key`; HMAC imzoli webhook; takroriy eventlar idempotent |
| Haydovchilar | Haydovchi profili, avtomobilga biriktirish (bir vaqtda bitta faol biriktirish), biriktirish tarixi; pasport va haydovchilik guvohnomasi (raqam, sanalar, PINFL, rasmlar); Telegram ism/username/rasmi profilga qo'shiladi |
| Kunlik to'lovlar | Avtomobilning oylik rejasi; har kuni ixtiyoriy summada naqd/plastik to'lov (haydovchi + avtomobilga bog'lanadi); qarz har oy alohida to'planadi, ortiqcha to'lov boshqa oyni yopmaydi; `/daily` sahifasida tezkor qidiruv va bir bosishda to'lov; har sahifadagi "Tezkor to'lov" oynasi (F2); oylik hisobot |
| Haydovchi boti | Haydovchi `/start` bosib "📱 Telefon raqamni yuborish" tugmasi orqali ulanadi (raqam bazadagi haydovchi telefoniga mos kelishi kerak; xavfsizlik uchun faqat o'z kontakti qabul qilinadi, qo'lda yozilgan raqam emas). Zaxira usul — web'dan olingan `/start KOD`. Inline tugmalar: Profil, Mashinam, Oylik plan (qarzlar), To'lovlarim, Hujjatlarim (pasport/guvohnoma ma'lumoti va rasmlarini kiritish/o'zgartirish), Yangilash. Xodimlar uchun alohida menyu |
| Super admin | `/admin`: barcha kompaniyalar, ularning statistikasi, kompaniyani to'xtatish/faollashtirish (`User.isSuperAdmin`) |
| Bildirishnomalar | Haydovchiga to'lov kvitansiyasi (avtomatik Telegram kvitansiya), kunlik qarzdorlik eslatmasi (worker cron), litsenziya muddati tugashi ogohlantirishi; web interfeysda bildirishnomalar jurnali (`/notifications`) va boshqaruv |
| SaaS obuna | Rejalar, trial, alohida invoice jadvali; transport to'lovlari bilan aralashmaydi |
| Audit | Append-only jurnal, DB trigger va privilege bilan o'zgartirish/o'chirish taqiqlangan |
| Hujjatlar | S3-compatible private bucket, presigned upload/download, hajm tekshiruvi |
| Telegram | Web'dan bir martalik bog'lash kodi; bot faqat API bilan ishlaydi, DB'ga ulanmaydi |
| Worker | Redis + BullMQ, kunlik SaaS billing jadvali, internal API orqali ishlaydi |
| Web | Next.js App Router, o'zbek lotin (default) va rus tili, `next-intl` |
| Infra | Docker Compose: PostgreSQL, Redis, MinIO, API, worker, bot, web, migration job |

Hukumat litsenziyasi yoki tender huquqi avtomatik berilmaydi — bu ataylab scope'dan tashqarida.

## Texnologiyalar

- **Frontend:** Next.js 15, React 19, TypeScript, Tailwind CSS, next-intl
- **Backend:** NestJS 11, TypeScript, Prisma 6, PostgreSQL 16
- **Infra:** Redis 7, BullMQ, Docker Compose
- **Bot:** Telegraf 4 (long polling), faqat HTTP API
- **Storage:** S3-compatible (MinIO lokal), private bucket

## Tez boshlash (lokal)

Talablar: Node.js >= 22.11, npm >= 10, Docker Desktop yoki Docker Engine.

```bash
cp .env.example .env
# .env dagi JWT, internal, bot va webhook kalitlarini almashtiring:
#   openssl rand -hex 32

npm install
npm run infra:up          # postgres, redis, minio
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

- Web: `http://localhost:3000/uz/login`
- API: `http://localhost:4000/api/v1`
- Swagger: `http://localhost:4000/api/docs` (lokalda `ENABLE_SWAGGER=true`)
- MinIO konsoli: `http://localhost:9001`

Ro'yxatdan o'tkazish sahifasida kompaniya yaratiladi va 14 kunlik `START` trial obunasi ochiladi. Keyin xodimlar, avtomobillar, yo'nalishlar, tariflar, shartnomalar va to'lovlarni kiritish mumkin.

`BOT_TOKEN` bo'sh bo'lsa bot ishga tushmaydi (xato bilan chiqadi); API va web ishlashda davom etadi. Bot uchun `@BotFather` tokenini `.env` ga yozing.

### Docker bilan to'liq stack

```bash
docker compose --profile app up -d --build
```

`migrate` servisi avval migratsiyalarni qo'llaydi, keyin API/worker/bot/web ishga tushadi. Bu **lokal/staging** uchun; production deploy uchun [SECURITY.md](docs/SECURITY.md) dagi checklist bajarilishi shart.

## Tekshirish

```bash
npm test                    # unit testlar (tarif dvigateli, webhook imzo)
npm run test:integration    # real PostgreSQL + RLS + API oqimlari
```

Integration testlar **test bazasini** (`TEST_DATABASE_URL`) tozalaydi. Hech qachon production URL qo'ymang. Natijalar: [Stage 1 hisoboti](docs/STAGE-1-REPORT.md).

## Loyiha tuzilishi

```
apps/
  api/        NestJS modular monolith + Prisma + RLS + webhook + internal API
  web/        Next.js BFF (httpOnly session) + o'zbek/rus interfeys
  worker/     BullMQ scheduler/worker; API internal endpointlarini chaqiradi
  bot/        Telegraf bot; faqat HTTP API
docker/
  postgres/   lokal rol va test bazasi bootstrap
docs/
  ARCHITECTURE.md
  SECURITY.md
  STAGE-1-REPORT.md
```

## Hujjatlar

- [Arxitektura](docs/ARCHITECTURE.md) — modullar, tenant modeli, RLS, pul va idempotentlik qarorlari
- [Xavfsizlik](docs/SECURITY.md) — threat model, boshqaruvlar, deployment checklist, ma'lum cheklovlar
- [Stage 1 hisoboti](docs/STAGE-1-REPORT.md) — bajarilgan, bajarilmagan, xavfli, keyingi vazifalar

## Litsenziya

Xususiy loyiha. Litsenziya egasi bilan kelishilishi kerak.
