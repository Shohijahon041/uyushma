#!/usr/bin/env node
/**
 * Telegram bot E2E tekshiruvi (staging).
 *
 * Ishlatish:
 *   npm run e2e:bot
 *   E2E_CHAT_ID=123456789 npm run e2e:bot          # botdan haqiqiy xabar yuboradi
 *   E2E_TENANT_ID=<uuid> npm run e2e:bot           # BullMQ -> dispatch zanjirini tekshiradi
 *
 * Token hech qachon konsolga chiqarilmaydi.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(file) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    let value = raw;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnv(join(root, ".env"));
loadEnv(join(root, ".env.staging"));

const token = process.env.BOT_TOKEN;
const apiUrl = (process.env.BOT_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");
const botApiKey = process.env.BOT_API_KEY;
const internalApiKey = process.env.INTERNAL_API_KEY;
const e2eChatId = process.env.E2E_CHAT_ID;
const e2eTenantId = process.env.E2E_TENANT_ID;

const results = [];
let failed = 0;

function report(name, ok, detail, skipped = false) {
  const icon = skipped ? "SKIP" : ok ? "PASS" : "FAIL";
  if (!ok && !skipped) failed += 1;
  results.push({ name, ok, detail });
  console.log(`[${icon}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function request(url, init = {}, timeoutMs = 10_000) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

async function telegram(method, payload) {
  const response = await request(
    `https://api.telegram.org/bot${token}/${method}`,
    payload
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      : {},
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) {
    throw new Error(body.description ?? `Telegram ${method} xatosi (${response.status})`);
  }
  return body.result;
}

async function main() {
  if (!token) {
    console.error("BOT_TOKEN topilmadi (.env). Tekshiruv to'xtatildi.");
    process.exit(1);
  }
  if (!botApiKey) {
    console.error("BOT_API_KEY topilmadi (.env). Tekshiruv to'xtatildi.");
    process.exit(1);
  }

  console.log(`Bot E2E · API: ${apiUrl}\n`);

  try {
    const me = await telegram("getMe");
    report("Telegram getMe", true, `@${me.username} (id ${me.id})`);
  } catch (error) {
    report("Telegram getMe", false, error.message);
  }

  try {
    const info = await telegram("getWebhookInfo");
    const pending = info.pending_update_count ?? 0;
    if (info.url) {
      report(
        "Long polling",
        false,
        `webhook o'rnatilgan (${info.url}) — long polling ishlamaydi`,
      );
    } else {
      report("Long polling", true, `webhook yo'q, kutilayotgan update: ${pending}`);
    }
  } catch (error) {
    report("Long polling", false, error.message);
  }

  for (const probe of ["live", "ready"]) {
    try {
      const response = await request(`${apiUrl}/api/v1/health/${probe}`);
      const text = await response.text();
      report(`API health/${probe}`, response.ok, response.ok ? `${response.status}` : `${response.status}: ${text.slice(0, 120)}`);
    } catch (error) {
      report(`API health/${probe}`, false, error.message);
    }
  }

  try {
    const denied = await request(`${apiUrl}/api/v1/integrations/telegram/profile?chatId=0`);
    const accepted = await request(`${apiUrl}/api/v1/integrations/telegram/profile?chatId=0`, {
      headers: { "X-Bot-Api-Key": botApiKey },
    });
    if (denied.status !== 401) {
      report("Bot API guard", false, `kalitsiz so'rov ${denied.status} qaytardi (401 kutilgan)`);
    } else if (accepted.status === 401) {
      report("Bot API guard", false, "to'g'ri BOT_API_KEY bilan ham 401");
    } else {
      report("Bot API guard", true, `kalitsiz 401, kalit bilan ${accepted.status} (auth o'tdi)`);
    }
  } catch (error) {
    report("Bot API guard", false, error.message);
  }

  if (e2eChatId) {
    try {
      const message = await telegram("sendMessage", {
        chat_id: e2eChatId,
        text: "Uyushmachilar: bot E2E tekshiruvi muvaffaqiyatli.",
      });
      report("Telegram sendMessage", true, `message_id ${message.message_id}`);
    } catch (error) {
      report("Telegram sendMessage", false, error.message);
    }
  } else {
    report("Telegram sendMessage", true, "E2E_CHAT_ID berilmagan", true);
  }

  if (e2eTenantId && internalApiKey) {
    try {
      const response = await request(`${apiUrl}/api/v1/internal/notifications/dispatch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Api-Key": internalApiKey,
        },
        body: JSON.stringify({
          event: {
            tenantId: e2eTenantId,
            type: "system.test",
            dedupeKey: `e2e__${Date.now()}`,
            occurredAt: new Date().toISOString(),
            data: { text: "BullMQ bildirishnoma zanjiri E2E testi." },
          },
        }),
      });
      const body = await response.json().catch(() => ({}));
      const ok = response.ok && body.status !== "FAILED";
      report(
        "Bildirishnoma dispatch",
        ok,
        response.ok
          ? `status=${body.status} recipients=${body.recipients} sent=${body.sent} failed=${body.failed}`
          : `${response.status}: ${JSON.stringify(body).slice(0, 160)}`,
      );
    } catch (error) {
      report("Bildirishnoma dispatch", false, error.message);
    }
  } else {
    report(
      "Bildirishnoma dispatch",
      true,
      "E2E_TENANT_ID va INTERNAL_API_KEY berilmagan",
      true,
    );
  }

  console.log(`\nNatija: ${results.length - failed}/${results.length} muvaffaqiyatli.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("E2E kutilmagan xato:", error.message);
  process.exit(1);
});
