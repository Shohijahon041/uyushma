import { Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

const MAX_BYTES = 10 * 1024 * 1024;

/** Telegram'da saqlangan rasmni (file_id) bot tokeni orqali yuklab beradi. */
@Injectable()
export class TelegramFiles {
  private readonly token: string | null;

  constructor(config: ConfigService) {
    this.token = config.get<string>("BOT_TOKEN")?.trim() || null;
  }

  /**
   * Telegram foydalanuvchisining profil rasm file_id'sini oladi. Haydovchi
   * bilan shaxsiy chatda chatId = userId bo'ladi.
   */
  async profilePhotoFileId(userId: bigint | number): Promise<string | null> {
    if (!this.token) return null;
    const id = userId.toString();
    if (!/^\d{1,20}$/.test(id)) return null;
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${this.token}/getUserProfilePhotos?user_id=${id}&limit=1`,
        { signal: AbortSignal.timeout(10_000) },
      );
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        result?: { photos?: Array<Array<{ file_id?: string }>> };
      } | null;
      const sizes = payload?.ok ? payload.result?.photos?.[0] : undefined;
      const fileId = sizes?.[sizes.length - 1]?.file_id;
      return fileId && /^[A-Za-z0-9_-]{20,255}$/.test(fileId) ? fileId : null;
    } catch {
      return null;
    }
  }

  async download(fileId: string): Promise<{ body: Buffer; contentType: string }> {
    if (!this.token) throw new ServiceUnavailableException("Telegram bot sozlanmagan");
    const meta = await fetch(
      `https://api.telegram.org/bot${this.token}/getFile?file_id=${encodeURIComponent(fileId)}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    const payload = (await meta.json().catch(() => null)) as {
      ok?: boolean;
      result?: { file_path?: string; file_size?: number };
    } | null;
    const path = payload?.ok ? payload.result?.file_path : undefined;
    if (!path || !/^[A-Za-z0-9_./-]+$/.test(path)) {
      throw new NotFoundException("Rasm Telegram'da topilmadi");
    }
    if ((payload?.result?.file_size ?? 0) > MAX_BYTES) {
      throw new NotFoundException("Rasm juda katta");
    }
    const file = await fetch(`https://api.telegram.org/file/bot${this.token}/${path}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!file.ok) throw new NotFoundException("Rasm Telegram'da topilmadi");
    const body = Buffer.from(await file.arrayBuffer());
    if (body.length > MAX_BYTES) throw new NotFoundException("Rasm juda katta");
    const lower = path.toLowerCase();
    const contentType = lower.endsWith(".png")
      ? "image/png"
      : lower.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";
    return { body, contentType };
  }
}
