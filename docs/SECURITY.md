# Xavfsizlik

## 1. Model va taxminlar

- Har bir kompaniya — mustaqil tenant. Foydalanuvchi bir vaqtda bitta tenantga tegishli.
- Platforma xodimi (superadmin) uchun alohida panel hozircha yo'q; shuning uchun barcha API yo'llari tenant JWT yoki xizmat kaliti talab qiladi.
- Production deploy qilinmagan. Ushbu hujjatdagi checklist bajarilmaguncha tizim production trafikka chiqarilmasligi kerak.
- Hukumat litsenziyasi va tender huquqi dastur tomonidan berilmaydi; bu huquqiy jarayon.

## 2. Tenant izolyatsiyasi

### Boshqaruvlar

| Qatlam | Boshqaruv |
| --- | --- |
| DB sxema | Har bir tenant jadvalida majburiy `tenantId` |
| DB RLS | `ENABLE` + `FORCE ROW LEVEL SECURITY`; policy `tenantId = app_current_tenant_id()` |
| DB kontekst | `set_config('app.tenant_id', ..., true)` faqat transaction ichida |
| DB FK | Composite FK `(childId, tenantId) → (parentId, tenantId)` |
| DB huquqlari | Ilova roli `NOSUPERUSER NOBYPASSRLS`, jadval egasi emas |
| Audit | Append-only, UPDATE/DELETE trigger va privilege bilan yopilgan |
| Delete | App roliga barcha jadvallarda `DELETE` taqiqlangan |
| Ilova | Tenant ID faqat JWT'dan; mijoz `tenantId` yuborishi mumkin emas |
| Test | RLS-siz 0 qator; cross-tenant FK rad etilishi; API cross-tenant 400 |

### Tekshirish (lokal)

```bash
# Tenant kontekstisiz hech narsa ko'rinmaydi
docker exec uyushma-postgres psql -U uyushma_app -d uyushma \
  -c 'SELECT count(*) FROM "Vehicle";'

# Tenant kontekstida faqat o'sha tenant qatorlari
docker exec uyushma-postgres psql -U uyushma_app -d uyushma \
  -c "BEGIN; SELECT set_config('app.tenant_id','<TENANT_UUID>',true); SELECT count(*) FROM \"Vehicle\"; ROLLBACK;"

# DELETE taqiqlangan
docker exec uyushma-postgres psql -U uyushma_app -d uyushma \
  -c "BEGIN; SELECT set_config('app.tenant_id','<TENANT_UUID>',true); DELETE FROM \"Vehicle\"; ROLLBACK;"
# ERROR: permission denied for table Vehicle
```

Integratsion testlar: `test/integration/tenant-isolation.spec.ts`.

### Production talablari

1. API rolini **jadval egasi qilmang** va unga `SUPERUSER`/`BYPASSRLS` bermang.
2. Migratsiyalarni alohida admin rol bilan bajaring (`MIGRATE_DATABASE_URL`), API'da ishlatmang.
3. Agar ilova roli nomi `uyushma_app` bo'lmasa, migratsiyadagi grant blokini ops jadvaliga moslang yoki alohida grant migratsiyasi yozing.
4. Yangi tenant jadvali qo'shilganda RLS policy, composite FK va grantlarni albatta qo'shing.
5. Connection pooler (PgBouncer) ishlatsangiz, transaction mode'da `SET LOCAL` ishlaydi; session mode'dan qoching yoki tekshiring.
6. Backend faqat private tarmoqda; PostgreSQL/Redis/MinIO internetga ochilmasin.

## 3. Autentifikatsiya va sessiya

- Parol talabi: kamida 12 belgi, harf va raqam. Argon2id (19 MiB, 2 iteratsiya, 1 parallel).
- Access token: 15 daqiqa, HMAC JWT, `iss`/`aud`/`typ` tekshiriladi. Rol DB'dan har so'rovda qayta o'qiladi (JWT'dagi eski rolga ishonilmaydi).
- Refresh token: 30 kun, faqat SHA-256 hash DB'da. Rotation har refresh'da. Eski token qayta ishlatilsa — foydalanuvchining barcha refresh tokenlari revoke qilinadi va audit yoziladi.
- Login timing/enumeration: tenant topilmasa ham dummy Argon2 verify bajariladi; xato javobi bir xil.
- Web: access/refresh tokenlar `httpOnly`, `SameSite=Lax`, `Secure` (production) cookie'da. JavaScript ularni o'qiy olmaydi.
- BFF mutatsiyalarida `Origin` tekshiriladi; API CORS faqat `APP_ORIGIN` uchun ochiq.
- Login/register/refresh/logout endpointlari throttling bilan cheklangan.
- Foydalanuvchi faolsizlantirilsa, uning refresh tokenlari revoke qilinadi; access token 15 daqiqada tugaydi.

### Rollar matritsasi (asosiy)

| Amal | OWNER | ADMIN | ACCOUNTANT | MANAGER |
| --- | --- | --- | --- | --- |
| Kompaniya sozlamalari / obuna rejasini almashtirish | ✅ | — | — | — |
| Xodim qo'shish/o'zgartirish | ✅ | ✅ (OWNER rolini bera olmaydi) | — | — |
| Avtomobil/yo'nalish/tarif/shartnoma yaratish | ✅ | ✅ | — | ✅ |
| To'lov yaratish / to'langan deb belgilash | ✅ | ✅ | ✅ | — |
| To'lovlar ro'yxati | ✅ | ✅ | ✅ | — |
| Hujjat yuklash | ✅ | ✅ | ✅ | — |
| Audit jurnali | ✅ | ✅ | ✅ | — |
| Dashboard | ✅ | ✅ | ✅ | ✅ |

Ro'yxatdan o'tishda birinchi foydalanuvchi `OWNER` bo'ladi.

## 4. Moliyaviy yaxlitlik

- Barcha summalar `NUMERIC(18,2)`/Decimal; frontend hisob qilmaydi.
- Manual to'lov `Idempotency-Key` talab qiladi; bir xil kalit + boshqa payload = 409.
- Webhook eventlari `(tenantId, provider, externalEventId)` unikal; takroriy event qayta qo'llanilmaydi.
- Invoice `(subscriptionId, periodStart)` unikal.
- Biznes mutatsiya va audit yozuvi bitta transactionda.
- Financial jadvalarda app rolidan `DELETE` olib tashlangan; tarixni o'chirish faqat admin tomonidan, alohida tasdiqlangan operatsiya bo'lishi kerak.

## 5. Webhook xavfsizligi

- Imzo: `sha256=HMAC-SHA256(secret, timestamp + "." + rawBody)`.
- `x-webhook-timestamp` 5 daqiqadan eski/yangi bo'lsa rad etiladi (replay oynasi).
- `rawBody` ishlatiladi; parsed JSON emas — imzo body bilan mos bo'lishi shart.
- `timingSafeEqual`.
- Tenant slug imzolangan payload ichida; tenant topilmasa bir xil 401.
- Summa payment bilan mos kelmasa event `FAILED`, javob 400.
- Hozir bitta platforma webhook secret'i ishlatiladi. Har bir tenant/provayder uchun alohida secret va rotation — stage 2.

## 6. Xizmat kalitlari

| Kalit | Kim ishlatadi | Saqlash |
| --- | --- | --- |
| `INTERNAL_API_KEY` | Worker → API internal endpointlar | `.env`/secret manager; faqat private tarmoq |
| `BOT_API_KEY` | Telegram bot → API | Bot konteyner env; bot DB'ga ulanmaydi |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | API | kamida 32 bayt random, alohida qiymatlar |
| `PAYMENT_WEBHOOK_SECRET` | Provayder va API | HMAC secret |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | API | minimal bucket huquqi |

Talablar:

- Barcha kalitlar `.env` yoki secret manager'da; **kodga, repoga, logga chiqmaydi**.
- Dev qiymatlari faqat lokal uchun; production'da almashtiriladi.
- `openssl rand -hex 32` bilan generatsiya.
- Rotation: JWT refresh secret almashtirilsa barcha sessiyalar tugaydi (rejalashtirilgan oyna); bot/internal kalitlar bir vaqtda yangilanadi.
- Internal endpointlar internetdan yopilishi shart (nginx allowlist, private subnet yoki service mesh). Kalitning o'zi tarmoq izolyatsiyasini almashtirmaydi.

## 7. Hujjatlar (S3)

- Bucket private; anonymous access 403 (tekshirilgan).
- Presigned URL qisqa muddatli (300 s default), faqat kerakli obyekt uchun.
- Fayl turi (PDF/JPEG/PNG/WebP) va hajmi (20 MB) tekshiriladi; tasdiqlashda `HeadObject` hajmi e'lon qilingan hajmga mosligi tekshiriladi.
- Kalit tenant prefiksi bilan; DB'da `Document` tenant scope'da.
- **Virus scanning yo'q.** Stage 2'da ClamAV yoki provayder scanning qo'shilishi kerak.
- S3 bucket versiyalash va lifecycle policy ops tomonidan sozlanadi.

## 8. Logging, maxfiylik, monitoring

- Request ID har javobda; xatolar stack trace faqat server logida, mijozga umumiy xabar.
- Parol, token, API key, S3 secret hech qachon logga yozilmaydi.
- Audit metadata minimal PII saqlaydi.
- Hozircha markazlashgan log/metrics/tracing yo'q. Production oldidan OpenTelemetry + log aggregator + alertlar kerak.
- Health: `/api/v1/health/live`, `/api/v1/health/ready`.

## 9. Production deployment checklist

- [ ] Barcha `.env` qiymatlari secret manager'dan; dev qiymatlari yo'q.
- [ ] `NODE_ENV=production`, `ENABLE_SWAGGER=false`, `SESSION_COOKIE_SECURE=true`.
- [ ] HTTPS/TLS terminatsiya; HSTS; faqat HTTPS redirect.
- [ ] `APP_ORIGIN` aniq production domeni; CORS boshqa originlarga yopiq.
- [ ] Ishonchli reverse proxy ortida `TRUST_PROXY=true` (aks holda audit/rate-limit IP'lari soxtalashtirilishi mumkin).
- [ ] API/bot/internal endpointlar private tarmoqda; internetdan faqat web.
- [ ] PostgreSQL admin va app rollari ajratilgan; app role `NOBYPASSRLS`; migratsiyalar CI job orqali.
- [ ] Backup + PITR yoqilgan va restore test qilingan.
- [ ] Redis parol/TLS va private tarmoq; MinIO private, versiyalash/lifecycle.
- [ ] Rate limiting uchun umumiy Redis storage (hozir in-memory) yoki WAF.
- [ ] Web BFF refresh uchun distributed lock yoki sticky sessions.
- [ ] Log/metrics/tracing/alerting; audit log export.
- [ ] DDoS/WAF, fail2ban, IP allowlist (internal).
- [ ] Dependency audit (`npm audit`) va image scanning.
- [ ] Load test (kamida API + web) va backupdan tiklash mashqi.
- [ ] E2E smoke test production'da alohida test tenant bilan.
- [ ] Egasining yozma ruxsati bilan deploy.

## 10. Ma'lum cheklovlar / qoldiq risklar

| Risk | Holat | Keyingi qadam |
| --- | --- | --- |
| Provayder integratsiyasi yo'q, faqat generic webhook | O'rtacha | Har bir provayder adapteri, per-tenant secret, reconciliation |
| Bitta global webhook secret | O'rtacha | Tenant-level secret + rotation |
| Refresh rotation reuse detection butun oilani revoke qiladi; distributed refresh lock yo'q | O'rtacha | Redis asosidagi single-flight; sessiyalar ro'yxati |
| In-memory rate limiting | O'rtacha | Redis throttler storage |
| 2FA, parol tiklash, email tasdiqlash yo'q | Yuqori (production uchun) | Auth stage 2 |
| Virus scanning yo'q | O'rtacha | S3 event + scanner |
| Audit yetarli darajada markazlashmagan; log aggregation yo'q | O'rtacha | SIEM/observability |
| Superadmin/platform operatsiyalari uchun alohida rol yo'q | Past | Alohida platforma moduli, alohida auth |
| Hujjat `key` API javobida ko'rinadi | Past | Response DTOdan olib tashlash |
| Swagger CSP yumshatilgan | Past | Faqat dev'da yoqish |
| Bot real token bilan sinalmagan | O'rta | Staging bot tokeni bilan E2E |

Hech qanday production tizimga ulanilmagan, deploy qilinmagan yoki o'zgartirilmagan.
