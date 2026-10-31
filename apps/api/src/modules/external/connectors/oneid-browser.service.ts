import { Injectable, Logger } from "@nestjs/common";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import * as fs from "fs";
import type { ExternalProvider } from "@prisma/client";
import { ONEID_SSO_URLS } from "./oneid.service";

export interface BrowserLoginResult {
  success: boolean;
  code?: string;
  error?: string;
  requiresSms?: boolean;
  pageUrl?: string;
}

@Injectable()
export class OneIdBrowserService {
  private readonly logger = new Logger(OneIdBrowserService.name);

  private readonly candidatePaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    process.env.CHROME_BIN,
    process.env.EDGE_BIN,
  ].filter(Boolean) as string[];

  /**
   * Tizimda Chrome yoki Edge brauzeri mavjudligini tekshirish
   */
  getExecutablePath(): string | null {
    for (const p of this.candidatePaths) {
      try {
        if (fs.existsSync(p)) {
          return p;
        }
      } catch {
        // ignore
      }
    }
    return null;
  }

  isAvailable(): boolean {
    return this.getExecutablePath() !== null;
  }

  /**
   * Playwright orqali OneID tizimiga avtomatlashtirilgan kirish (Headless)
   */
  async loginAutomated(
    provider: ExternalProvider,
    username: string,
    password: string,
  ): Promise<BrowserLoginResult> {
    const executablePath = this.getExecutablePath();
    if (!executablePath) {
      return {
        success: false,
        error: "Serverda Google Chrome yoki Microsoft Edge brauzeri topilmadi",
      };
    }

    const ssoUrl = ONEID_SSO_URLS[provider] ?? ONEID_SSO_URLS.ETENDER;
    let browser: Browser | null = null;

    try {
      this.logger.log(`OneID Playwright login boshlanmoqda provider=${provider} user=${username}`);
      browser = await chromium.launch({
        executablePath,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
        ],
      });

      const context: BrowserContext = await browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 800 },
      });

      const page: Page = await context.newPage();

      let interceptedCode: string | null = null;

      // URL o'zgarishini kuzatish
      page.on("framenavigated", (frame) => {
        const u = frame.url();
        const match = u.match(/[?&](?:one_code|code)=([^&#\s]+)/i);
        if (match && match[1]) {
          interceptedCode = decodeURIComponent(match[1]).trim();
          this.logger.log(`OneID redirect orqali kod tutib olindi!`);
        }
      });

      await page.goto(ssoUrl, { waitUntil: "domcontentloaded", timeout: 25000 });

      // Agar sahifada allaqachon kod bo'lsa
      if (interceptedCode) {
        return { success: true, code: interceptedCode };
      }

      // Inputlarni kutish
      try {
        await page.waitForSelector('input[name="login"], input#login, input[type="text"]', {
          timeout: 10000,
        });
      } catch {
        // Agar selektor topilmasa
      }

      const loginInput =
        (await page.$('input[name="login"]')) ??
        (await page.$('input[placeholder*="Login"]')) ??
        (await page.$('input[type="text"]'));

      const passwordInput =
        (await page.$('input[name="password"]')) ??
        (await page.$('input[type="password"]'));

      if (!loginInput || !passwordInput) {
        // URL da kod bormi tekshirish
        const curUrl = page.url();
        const match = curUrl.match(/[?&](?:one_code|code)=([^&#\s]+)/i);
        if (match && match[1]) {
          return { success: true, code: decodeURIComponent(match[1]).trim() };
        }
        return {
          success: false,
          error: "OneID kirish oynasida login va parol maydonlari topilmadi",
          pageUrl: curUrl,
        };
      }

      // Login va parolni kiritish
      await loginInput.fill(username);
      await passwordInput.fill(password);

      // Kirish tugmasini bosish
      const submitBtn =
        (await page.$('button[type="submit"]')) ??
        (await page.$('button:has-text("Kirish")')) ??
        (await page.$('input[type="submit"]'));

      if (submitBtn) {
        await submitBtn.click();
      } else {
        await passwordInput.press("Enter");
      }

      // 8 soniya davomida natijani kutish (kod, xato yoki SMS)
      for (let i = 0; i < 16; i++) {
        await page.waitForTimeout(500);

        if (interceptedCode) {
          return { success: true, code: interceptedCode };
        }

        const curUrl = page.url();
        const match = curUrl.match(/[?&](?:one_code|code)=([^&#\s]+)/i);
        if (match && match[1]) {
          return { success: true, code: decodeURIComponent(match[1]).trim() };
        }

        // SMS kodi so'ralyaptimi?
        const hasSmsInput = await page.$('input[name="sms_code"], input[name="code"]');
        const bodyText = (await page.innerText("body").catch(() => "")) || "";
        const isSms =
          !!hasSmsInput ||
          bodyText.includes("SMS") ||
          bodyText.includes("kod yuborildi") ||
          bodyText.includes("Tasdiqlash kodi");

        if (isSms) {
          return {
            success: false,
            requiresSms: true,
            error: "OneID SMS tasdiqlash kodini talab qilmoqda. Rasmiy OneID SSO orqali kiring.",
          };
        }

        // Xatolik xabarlari bormi?
        const alerts = await page.$$eval(
          '.MuiAlert-message, [role="alert"], .error, .toast, .text-danger',
          (els) => els.map((e) => e.innerText.trim()).filter(Boolean),
        );
        if (alerts.length > 0) {
          return {
            success: false,
            error: `OneID xatosi: ${alerts[0]}`,
          };
        }
      }

      return {
        success: false,
        error: "OneID dan javob kutish vaqti tugadi (Timeout)",
        pageUrl: page.url(),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`OneID Playwright login xatosi: ${msg}`);
      return { success: false, error: msg };
    } finally {
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }
  }

  /**
   * Foydalanuvchi oldida ko'rinadigan (interactive) brauzer oynasini ochish
   * Foydalanuvchi kirishi bilan kodni avtomatik ushlab olib oynani yopadi.
   */
  async launchInteractiveWindow(
    provider: ExternalProvider,
    onCodeReceived: (code: string) => Promise<void>,
  ): Promise<{ success: boolean; message: string }> {
    const executablePath = this.getExecutablePath();
    if (!executablePath) {
      return {
        success: false,
        message: "Serverda Google Chrome yoki Microsoft Edge brauzeri topilmadi",
      };
    }

    const ssoUrl =
      provider === "IJARA"
        ? "https://ijara.soliq.uz/login"
        : ONEID_SSO_URLS[provider] ?? ONEID_SSO_URLS.ETENDER;

    // Asinxron holda brauzerni ishga tushirish
    void (async () => {
      let browser: Browser | null = null;
      try {
        browser = await chromium.launch({
          executablePath,
          headless: false,
          args: ["--start-maximized"],
        });

        const context = await browser.newContext({
          viewport: null,
          userAgent:
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        });

        const page = await context.newPage();

        let resolved = false;

        const completeWithToken = async (captured: string, source: string) => {
          if (resolved) return;
          resolved = true;
          this.logger.log(`Interactive ${provider} token/kod tutib olindi (${source})!`);
          try {
            await onCodeReceived(captured);
          } catch (inner) {
            this.logger.error(`onCodeReceived xatosi: ${inner}`);
          }
          setTimeout(() => {
            browser?.close().catch(() => undefined);
          }, 1500);
        };

        // 1. So'rov sarlavhalaridan Bearer tokenni tutish (ayniqsa Soliq Ijara uchun)
        page.on("request", (req) => {
          if (resolved) return;
          const auth = req.headers()["authorization"];
          if (auth && auth.toLowerCase().startsWith("bearer eyj")) {
            const clean = auth.replace(/^Bearer\s+/i, "").trim();
            void completeWithToken(clean, "Request Authorization Header");
          }
        });

        // 2. JSON javoblaridan tokenni tutish
        page.on("response", async (res) => {
          if (resolved) return;
          try {
            const ct = res.headers()["content-type"] || "";
            if (ct.includes("application/json")) {
              const text = await res.text().catch(() => "");
              if (text.includes("eyJ")) {
                const match = text.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
                if (match) {
                  void completeWithToken(match[0], "JSON Response");
                }
              }
            }
          } catch {
            // ignore
          }
        });

        // 3. Navigatsiya orqali OneID kodini tutish
        page.on("framenavigated", (frame) => {
          if (resolved) return;
          const u = frame.url();
          const match = u.match(/[?&](?:one_code|code)=([^&#\s]+)/i);
          if (match && match[1]) {
            const code = decodeURIComponent(match[1]).trim();
            void completeWithToken(code, "OAuth Redirect");
          }
        });

        // 4. Soliq Ijara uchun LocalStorage-ni vaqti-vaqti bilan tekshirib turish
        let storageTimer: NodeJS.Timeout | null = null;
        if (provider === "IJARA") {
          storageTimer = setInterval(async () => {
            if (resolved) {
              if (storageTimer) clearInterval(storageTimer);
              return;
            }
            try {
              const val = await page.evaluate(() => {
                const gStorage = (globalThis as unknown as { localStorage?: { getItem(k: string): string | null } }).localStorage;
                if (!gStorage) return null;
                const t = gStorage.getItem("token") || gStorage.getItem("access_token");
                if (typeof t === "string" && t.startsWith("eyJ")) return t;
                const root = gStorage.getItem("persist:root");
                if (typeof root === "string") {
                  const m = root.match(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/);
                  if (m) return m[0];
                }
                return null;
              });
              if (val) {
                if (storageTimer) clearInterval(storageTimer);
                void completeWithToken(val, "LocalStorage");
              }
            } catch {
              // ignore
            }
          }, 1500);
        }

        await page.goto(ssoUrl, { waitUntil: "domcontentloaded" });

        // 2 daqiqa kutish, keyin avtomatik yopish
        setTimeout(() => {
          if (storageTimer) clearInterval(storageTimer);
          if (!resolved) {
            browser?.close().catch(() => undefined);
          }
        }, 120000);
      } catch (err) {
        this.logger.error(`Interactive browser xatosi: ${err}`);
        if (browser) await browser.close().catch(() => undefined);
      }
    })();

    return {
      success: true,
      message: "OneID kirish brauzer oynasi ochildi. Unda kirishni bajaring.",
    };
  }
}
