import * as dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testMigrateUrl = process.env.TEST_MIGRATE_DATABASE_URL;

if (!testDatabaseUrl || !testMigrateUrl) {
  throw new Error(
    "Integration testlar uchun TEST_DATABASE_URL va TEST_MIGRATE_DATABASE_URL kerak (root .env).",
  );
}

// The application must connect through the limited role so RLS is active.
process.env.DATABASE_URL = testDatabaseUrl;
process.env.MIGRATE_DATABASE_URL = testMigrateUrl;
process.env.NODE_ENV = "test";
process.env.ENABLE_SWAGGER = "false";
process.env.THROTTLE_DISABLED = "true";
process.env.PAYMENT_WEBHOOK_SECRET =
  process.env.PAYMENT_WEBHOOK_SECRET ?? "test-webhook-secret-0123456789abcdef";
process.env.INTERNAL_API_KEY =
  process.env.INTERNAL_API_KEY ?? "test-internal-key-0123456789abcdef";
process.env.BOT_API_KEY =
  process.env.BOT_API_KEY ?? "test-bot-key-0123456789abcdef";
process.env.APP_ENCRYPTION_KEY =
  process.env.APP_ENCRYPTION_KEY ??
  "test-encryption-key-0123456789abcdef0123456789abcdef";
