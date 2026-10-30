# Staging muhiti — ishga tushirish va ekspluatatsiya

Ushbu hujjat `docker-compose.staging.yml` bilan ko'tariladigan to'liq staging
stekini tavsiflaydi: TLS, WAL-G bilan backup/PITR, Prometheus/Grafana/Loki
observability va Redis-asosidagi rate limiting.

## 1. Talablar

- Linux server (2–4 vCPU, 8 GB RAM, 40 GB disk), Docker 24+ va Compose v2.
- Domen (masalan `staging.uyushmachilar.uz`) A-yozuvi server IP'siga qaratilgan.
- 80 va 443 portlari tashqaridan ochiq (Caddy Let's Encrypt sertifikat oladi).
- Git'ga hech qanday maxfiy qiymat tushmasligi kerak.

## 2. Birinchi deploy

```bash
git clone <repo> uyushma && cd uyushma
node scripts/staging-bootstrap.mjs --domain staging.uyushmachilar.uz
# .env.staging va .staging/metrics_token avtomatik yaratiladi (0600).
# BOT_TOKEN bo'sh bo'lsa, .env.staging ichiga qo'lda yozing.

npm run staging:up
```

Birinchi ko'tarishda tartib avtomatik: PostgreSQL → `uyushma_app` roli →
`prisma migrate deploy` → API → worker/bot/web → Caddy.

Tekshirish:

```bash
curl -fsS https://staging.uyushmachilar.uz/api/v1/health/live
curl -fsS https://staging.uyushmachilar.uz/uz/login -o /dev/null -w '%{http_code}\n'
docker compose --env-file .env.staging -f docker-compose.staging.yml ps
```

## 3. TLS va tarmoq chegarasi

- Caddy `80/443` ni ochadi va sertifikatni avtomatik yangilaydi.
- Tashqariga faqat quyidagilar chiqadi:
  - `https://DOMAIN/*` → Next.js BFF (`web:3000`)
  - `https://DOMAIN/api/v1/webhooks/*` → API (`api:4000`)
- API, PostgreSQL, Redis, MinIO, Prometheus, Loki va Grafana portlari
  tashqariga ochilmagan. Grafana/Prometheus/Loki faqat `127.0.0.1` da:

```bash
ssh -L 3001:127.0.0.1:3001 -L 9090:127.0.0.1:9090 -L 3100:127.0.0.1:3100 user@server
# Grafana: http://localhost:3001 (login .env.staging dagi GRAFANA_ADMIN_*)
# Prometheus: http://localhost:9090
```

Xavfsizlik sarlavhalari (HSTS, `X-Frame-Options`, `nosniff`) Caddy darajasida
qo'shiladi. API'da `TRUST_PROXY=true` va `ENABLE_SWAGGER=false`.

## 4. Backup va PITR (WAL-G + MinIO)

- WAL har 60 soniyada `s3://uyushma-backups/wal` ga arxivlanadi
  (`archive_mode=on`, `archive_timeout=60`).
- `backup` konteyneri ishga tushganda va har 24 soatda base backup oladi,
  `BACKUP_RETENTION=7` kunlik saqlash bilan.
- MinIO bucket'lari: `uyushma-private` (fayllar), `uyushma-backups` (WAL/backup).

Backup holatini tekshirish:

```bash
docker compose --env-file .env.staging -f docker-compose.staging.yml logs --tail=50 backup
```

Tiklash (joriy bazani almashtiradi, 10 soniya bekor qilish imkoni bor):

```bash
./scripts/staging-restore.sh                          # oxirgi base backup
./scripts/staging-restore.sh "2026-10-30 12:00:00+00" # PITR: aniq vaqtga
```

Tiklangandan so'ng `npm run staging:up` bilan qolgan servislarni ko'taring.
Har oyda kamida bir marta alohida muhitda restore mashqi o'tkazing.

## 5. Observability

- **Prometheus** `api:4000/api/v1/metrics` ni `METRICS_TOKEN` bilan scrape qiladi
  (`docker/observability/prometheus.yml`).
- **Alertlar** (`docker/observability/alerts.yml`): API down, 5xx > 5%,
  p95 > 2s, Telegram yuborish xatolari, Payme auth xatolari, 503 ko'payishi.
  Alertmanager ulanmagan; alertlar Prometheus UI'da ko'rinadi. Production'da
  Alertmanager yoki Grafana alerting qo'shing.
- **Grafana** provisioning bilan "Uyushmachilar — staging" dashboardini yuklaydi.
- **Loki + Promtail** Docker loglarini yig'adi (14 kun saqlash). Promtail
  `/var/run/docker.sock` va `/var/lib/docker/containers` ga read-only ulanadi.

Foydali Loki so'rovlari:

```
{container=~".*uyushma-staging-api.*"} |~ "(?i)error|exception"
{container=~".*uyushma-staging-worker.*"}
{container=~".*uyushma-staging-bot.*"} |~ "(?i)launch|polling"
```

## 6. Rate limiting

- `@nestjs/throttler` Redis storage orqali ishlaydi (global 120 so'rov/daqiqa).
- Payme webhook uchun 600 so'rov/daqiqa (`@Throttle`), umumiy webhook uchun
  alohida limit.
- `THROTTLE_DISABLED=true` faqat testlarda ishlatiladi; staging'da hech qachon
  yoqmang. Redis paroli `.env.staging` da (`REDIS_PASSWORD`).

## 7. Telegram bot

- `BOT_TOKEN` `.env.staging` da; bot faqat `api:4000` orqali ishlaydi.
- Long polling: bir vaqtda faqat bitta bot nusxasi ishlashi shart (409 xatosi
  oldini oladi). Compose bitta `bot` konteynerini ko'taradi.
- E2E:

```bash
npm run e2e:bot
# To'liq zanjir uchun (tenantda bog'langan Telegram akkaunt bo'lishi kerak):
E2E_CHAT_ID=<chat_id> E2E_TENANT_ID=<tenant_uuid> npm run e2e:bot
```

- Foydalanuvchi akkauntni bog'lashi: web panel → Sozlamalar → Telegram →
  kod olish → botga `/start KOD` yuborish. Buni faqat haqiqiy Telegram
  foydalanuvchisi bajara oladi.

## 8. Payme

1. Web panel → Sozlamalar → To'lovlar bo'limida merchant ID, login va kalitni
   kiriting (kalit per-tenant AES-256-GCM bilan shifrlanadi).
2. Payme kabinetida webhook manzili:
   `https://DOMAIN/api/v1/webhooks/payments/payme` (yoki `.../payme/<tenantSlug>`).
3. Payme Basic auth yuboradi: login va kalit tenant sozlamalaridagi qiymatlar.
4. Reconcile: har kuni 04:00 (Asia/Tashkent) worker orqali; qo'lda:
   `POST /api/v1/internal/payments/reconcile-all` (X-Internal-Api-Key).

## 9. Yangilash va aylantirish

```bash
git pull
npm run staging:up      # image'lar qayta quriladi, migratsiya avtomatik
```

Maxfiy kalitlarni aylantirish:

- `JWT_*` — barcha sessiyalar bekor bo'ladi (qayta login).
- `APP_ENCRYPTION_KEY` — eski shifrmatnlar ochilmay qoladi; avval
  `PaymentProviderAccount` sirlarini qayta kiritish rejasini tuzing.
- `METRICS_TOKEN` — `.env.staging` va `.staging/metrics_token` ni birga
  yangilang, Prometheus'ni qayta ishga tushiring.
- `POSTGRES_PASSWORD` / `APP_DB_PASSWORD` / `REDIS_PASSWORD` — Compose'ni
  qayta ko'tarishdan oldin bazadagi rolni `ALTER ROLE` bilan yangilang.

## 10. Nosozliklar

| Belgi | Tekshirish |
| --- | --- |
| 502/504 | `docker compose ... logs api caddy`; API healthcheck |
| Login ishlamayapti | `SESSION_COOKIE_SECURE=true`, `APP_ORIGIN=https://DOMAIN` |
| Bot javob bermayapti | `bot` logida `started`; boshqa bot nusxasi yo'qligi; token |
| Webhook 401 | Tenant Payme login/kaliti, `archived` hisob, Payme Basic header |
| Backup yo'q | `backup` logi, MinIO `uyushma-backups`, WAL-G env |
| Rate limit juda qattiq | `http_requests_total{status="429"}` grafigi |

## 11. Staging'da taqiqlangan amallar

- `ENABLE_SWAGGER=true`, `THROTTLE_DISABLED=true`, `SESSION_COOKIE_SECURE=false`.
- Bir nechta bot nusxasini parallel ishga tushirish.
- `.env.staging` yoki `.staging/` ni Git'ga qo'shish.
- `docker compose down -v` (volume'lar, ya'ni baza va backuplar o'chadi).
