import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "staging", "production"])
    .default("development"),
  DATABASE_URL: z.string().url(),
  MIGRATE_DATABASE_URL: z.string().url().optional(),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_ORIGIN: z.string().url(),
  APP_ENCRYPTION_KEY: z.string().min(32),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1).default("uyushmachilar"),
  JWT_AUDIENCE: z.string().min(1).default("uyushmachilar-api"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(3600)
    .max(31536000)
    .default(2592000),
  REDIS_URL: z.string().url().default("redis://localhost:6380"),
  INTERNAL_API_KEY: z.string().min(16),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16),
  BOT_API_KEY: z.string().min(16),
  BOT_TOKEN: z.string().optional(),
  METRICS_ENABLED: booleanString.default("true"),
  METRICS_TOKEN: z.string().min(16).optional(),
  NOTIFICATIONS_ENABLED: booleanString.default("true"),
  PAYME_CHECKOUT_URL: z.string().url().default("https://checkout.paycom.uz"),
  PAYME_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(720),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanString.default("true"),
  S3_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
  SESSION_COOKIE_SECURE: booleanString.optional(),
  ENABLE_SWAGGER: booleanString.default("false"),
  THROTTLE_DISABLED: booleanString.default("false"),
  TRUST_PROXY: booleanString.default("false"),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return result.data;
}
