import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer, { type Transporter } from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly driver: "log" | "smtp";
  private readonly from: string;
  private readonly transporter: Transporter | null;

  constructor(private readonly config: ConfigService) {
    this.driver = config.get<"log" | "smtp">("EMAIL_DRIVER", "log");
    this.from = config.get<string>(
      "EMAIL_FROM",
      "Uyushmachilar <no-reply@uyushmachilar.uz>",
    );

    if (this.driver === "smtp") {
      const user = config.get<string>("SMTP_USER");
      this.transporter = nodemailer.createTransport({
        host: config.getOrThrow<string>("SMTP_HOST"),
        port: config.get<number>("SMTP_PORT", 587),
        secure: config.get<boolean>("SMTP_SECURE", false),
        ...(user
          ? { auth: { user, pass: config.get<string>("SMTP_PASS") ?? "" } }
          : {}),
      });
    } else {
      this.transporter = null;
    }
  }

  private webUrl(path: string): string {
    return `${this.config.getOrThrow<string>("APP_ORIGIN").replace(/\/$/, "")}${path}`;
  }

  private layout(title: string, body: string): string {
    return `<!doctype html><html lang="uz"><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;padding:32px">
<tr><td><div style="font-size:13px;font-weight:700;letter-spacing:.08em;color:#0f766e">UYUSHMACHILAR</div>
<h1 style="font-size:22px;margin:15px 0 12px">${escapeHtml(title)}</h1>
<div style="font-size:14px;line-height:1.65;color:#334155">${body}</div>
<p style="margin-top:28px;font-size:12px;color:#94a3b8">Bu xabar avtomatik yuborildi. Javob yozmang.</p>
</td></tr></table></td></tr></table></body></html>`;
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.transporter) {
      if (this.config.get<string>("NODE_ENV") !== "production") {
        this.logger.log(
          `[email:log] to=${message.to} subject="${message.subject}"\n${message.text}`,
        );
      }
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (error) {
      // Auth flows must not fail open or leak token state; the caller decides
      // whether to surface a retry to the user.
      this.logger.error(
        `Email yuborilmadi to=${message.to}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  async sendVerification(input: {
    to: string;
    fullName: string;
    companySlug: string;
    token: string;
  }): Promise<void> {
    const link = this.webUrl(
      `/uz/verify-email?slug=${encodeURIComponent(input.companySlug)}&token=${encodeURIComponent(input.token)}`,
    );
    await this.send({
      to: input.to,
      subject: "Email manzilingizni tasdiqlang",
      text: `Assalomu alaykum, ${input.fullName}!\n\nEmail manzilingizni tasdiqlash uchun havolani oching:\n${link}\n\nHavola 24 soat amal qiladi.`,
      html: this.layout(
        "Email manzilingizni tasdiqlang",
        `<p>Assalomu alaykum, <b>${escapeHtml(input.fullName)}</b>!</p>
<p>Hisobingizni faollashtirish uchun quyidagi tugmani bosing. Havola 24 soat amal qiladi.</p>
<p style="margin:26px 0"><a href="${link}" style="background:#0f766e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">Emailni tasdiqlash</a></p>
<p style="font-size:12px;color:#64748b">Agar tugma ochilmasa: ${escapeHtml(link)}</p>`,
      ),
    });
  }

  async sendPasswordReset(input: {
    to: string;
    fullName: string;
    companySlug: string;
    token: string;
  }): Promise<void> {
    const link = this.webUrl(
      `/uz/reset-password?slug=${encodeURIComponent(input.companySlug)}&token=${encodeURIComponent(input.token)}`,
    );
    await this.send({
      to: input.to,
      subject: "Parolni tiklash havolasi",
      text: `Assalomu alaykum, ${input.fullName}!\n\nParolni tiklash uchun havola:\n${link}\n\nHavola 30 daqiqa amal qiladi. Agar siz so'ramagan bo'lsangiz, bu xabarni e'tiborsiz qoldiring.`,
      html: this.layout(
        "Parolni tiklash",
        `<p>Assalomu alaykum, <b>${escapeHtml(input.fullName)}</b>!</p>
<p>Parolni yangilash uchun quyidagi tugmani bosing. Havola 30 daqiqa amal qiladi.</p>
<p style="margin:26px 0"><a href="${link}" style="background:#0f766e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600">Parolni tiklash</a></p>
<p style="font-size:12px;color:#64748b">Agar siz so'ramagan bo'lsangiz, parolingiz o'zgarmaydi.</p>`,
      ),
    });
  }

  async sendSecurityAlert(input: {
    to: string;
    fullName: string;
    action: string;
    ip: string | null;
  }): Promise<void> {
    await this.send({
      to: input.to,
      subject: "Xavfsizlik bildirishnomasi",
      text: `Assalomu alaykum, ${input.fullName}!\n\nHisobingizda quyidagi amal bajarildi: ${input.action}.\nIP: ${input.ip ?? "noma'lum"}.\n\nAgar bu siz bo'lmasangiz, darhol parolni o'zgartiring va qo'llab-quvvatlashga murojaat qiling.`,
      html: this.layout(
        "Xavfsizlik bildirishnomasi",
        `<p>Assalomu alaykum, <b>${escapeHtml(input.fullName)}</b>!</p>
<p>Hisobingizda quyidagi amal bajarildi: <b>${escapeHtml(input.action)}</b>.</p>
<p>IP manzil: <code>${escapeHtml(input.ip ?? "noma'lum")}</code></p>
<p>Agar bu siz bo'lmasangiz, darhol parolni o'zgartiring.</p>`,
      ),
    });
  }
}
