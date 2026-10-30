import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

interface TelegramResponse {
  ok: boolean;
  description?: string;
  parameters?: { retry_after?: number };
}

@Injectable()
export class TelegramNotifier {
  private readonly logger = new Logger(TelegramNotifier.name);
  private readonly token: string | null;

  constructor(config: ConfigService) {
    this.token = config.get<string>("BOT_TOKEN")?.trim() || null;
    if (!this.token) {
      this.logger.warn("BOT_TOKEN yo'q: Telegram bildirishnomalari yuborilmaydi");
    }
  }

  get enabled(): boolean {
    return this.token !== null;
  }

  private async call(chatId: string, text: string): Promise<void> {
    if (!this.token) throw new Error("BOT_TOKEN sozlanmagan");
    const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json().catch(() => null)) as TelegramResponse | null;
    if (!response.ok || !payload?.ok) {
      if (response.status === 429 && payload?.parameters?.retry_after) {
        const waitMs = Math.min(payload.parameters.retry_after, 30) * 1_000;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        return this.call(chatId, text);
      }
      throw new Error(
        `Telegram ${response.status}: ${payload?.description ?? "noma'lum xato"}`,
      );
    }
  }

  async send(chatId: string, text: string): Promise<void> {
    await this.call(chatId, text);
  }
}

export function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatMoney(value: string): string {
  const [integer = "0", fraction = "00"] = value.split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}.${fraction.padEnd(2, "0")} so'm`;
}
