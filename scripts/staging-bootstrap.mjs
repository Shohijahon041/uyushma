#!/usr/bin/env node
/**
 * Staging uchun .env.staging va metrics tokenini generatsiya qiladi.
 * Mavjud fayllarni hech qachon ustiga yozmaydi. Maxfiy qiymatlar konsolga
 * chiqarilmaydi.
 *
 *   node scripts/staging-bootstrap.mjs --domain staging.example.uz
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env.staging");
const secretDir = join(root, ".staging");

const domainArg = (() => {
  const index = process.argv.indexOf("--domain");
  return index > -1 ? process.argv[index + 1] : process.env.STAGING_DOMAIN;
})();

if (!domainArg) {
  console.error("Foydalanish: node scripts/staging-bootstrap.mjs --domain staging.example.uz");
  process.exit(1);
}

if (existsSync(envPath)) {
  console.error(".env.staging allaqachon mavjud. Ustiga yozilmadi.");
  process.exit(1);
}

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return values;
}

const hex = (bytes = 32) => randomBytes(bytes).toString("hex");
const base64Key = () => randomBytes(32).toString("base64");
const local = readEnvFile(join(root, ".env"));

const values = {
  NODE_ENV: "staging",
  DOMAIN: domainArg,

  POSTGRES_PASSWORD: hex(),
  APP_DB_PASSWORD: hex(),
  REDIS_PASSWORD: hex(),

  JWT_ACCESS_SECRET: hex(48),
  JWT_REFRESH_SECRET: hex(48),
  APP_ENCRYPTION_KEY: base64Key(),
  INTERNAL_API_KEY: hex(24),
  BOT_API_KEY: hex(24),
  PAYMENT_WEBHOOK_SECRET: hex(32),
  METRICS_TOKEN: hex(24),

  BOT_TOKEN: local.BOT_TOKEN ?? "",

  MINIO_ROOT_USER: "uyushma",
  MINIO_ROOT_PASSWORD: hex(),
  BACKUP_BUCKET: "uyushma-backups",
  S3_BUCKET: "uyushma-private",
  S3_REGION: "us-east-1",
  S3_FORCE_PATH_STYLE: "true",
  S3_PRESIGN_TTL_SECONDS: "300",

  PAYME_CHECKOUT_URL: "https://checkout.paycom.uz",
  PAYME_TIMEOUT_MINUTES: "720",
  REQUIRE_EMAIL_VERIFICATION: "false",
  EMAIL_DRIVER: "log",
  EMAIL_FROM: "Uyushmachilar <no-reply@uyushmachilar.uz>",

  GRAFANA_ADMIN_USER: "admin",
  GRAFANA_ADMIN_PASSWORD: hex(16),

  ACME_EMAIL: `devops@${domainArg}`,
};

values.S3_ACCESS_KEY = values.MINIO_ROOT_USER;
values.S3_SECRET_KEY = values.MINIO_ROOT_PASSWORD;

const lines = [
  "# Avtomatik generatsiya: scripts/staging-bootstrap.mjs",
  "# Bu fayl Git'ga tushmaydi. Maxfiy qiymatlarni boshqalarga yubormang.",
  ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
  "",
];
writeFileSync(envPath, lines.join("\n"), { mode: 0o600 });

mkdirSync(secretDir, { recursive: true });
writeFileSync(join(secretDir, "metrics_token"), values.METRICS_TOKEN, { mode: 0o600 });

console.log(".env.staging yaratildi (0600).");
console.log(".staging/metrics_token yaratildi (0600).");
if (!values.BOT_TOKEN) {
  console.log(
    "Diqqat: BOT_TOKEN bo'sh. Uni .env.staging ichiga qo'lda yozing yoki root .env dan ko'chiring.",
  );
}
console.log(
  `Keyingi qadam: docker compose --env-file .env.staging -f docker-compose.staging.yml up -d --build`,
);
