import { join } from "node:path";
import dotenv from "dotenv";
import { Telegraf, type Context } from "telegraf";
import { message } from "telegraf/filters";
import {
  ApiError,
  BotApiClient,
  type BotDocuments,
  type BotDriver,
  type BotSummary,
  type DocumentField,
  type TelegramProfile,
} from "./api-client";

dotenv.config({ path: join(process.cwd(), "../../.env") });
dotenv.config();

const token = process.env.BOT_TOKEN;
const apiUrl = process.env.BOT_API_URL;
const botApiKey = process.env.BOT_API_KEY;

if (!token) {
  console.error(
    "BOT_TOKEN yo'q. @BotFather orqali token oling va .env faylga yozing. Bot ishga tushmadi.",
  );
  process.exit(1);
}
if (!apiUrl || !botApiKey) {
  console.error("BOT_API_URL va BOT_API_KEY majburiy");
  process.exit(1);
}

const api = new BotApiClient(apiUrl, botApiKey);
const bot = new Telegraf(token);

function money(value: string): string {
  const parts = value.split(".");
  const int = parts[0] ?? "0";
  const fraction = parts[1] ?? "00";
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}.${fraction.padEnd(2, "0")} so'm`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function chatIdOf(ctx: Context): string {
  const id = ctx.chat?.id;
  if (id === undefined) throw new Error("chat topilmadi");
  return String(id);
}

function isUnlinked(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

const CONTACT_KEYBOARD = {
  keyboard: [[{ text: "📱 Telefon raqamni yuborish", request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

const unlinkedMessage = [
  "Assalomu alaykum! Botdan foydalanish uchun ro'yxatdan o'ting.",
  "",
  "👇 Pastdagi <b>📱 Telefon raqamni yuborish</b> tugmasini bosing.",
  "Raqamingiz kompaniya ro'yxatida bo'lsa, akkaunt darhol ulanadi.",
  "",
  "<i>Xodimlar: web paneldagi kod bilan</i> <code>/start KOD</code>",
].join("\n");

async function sendUnlinked(ctx: Context, prefix?: string): Promise<void> {
  await ctx.reply(prefix ? `${prefix}\n\n${unlinkedMessage}` : unlinkedMessage, {
    parse_mode: "HTML",
    reply_markup: CONTACT_KEYBOARD,
  });
}

async function safeReply(ctx: Context, fn: () => Promise<string>): Promise<void> {
  try {
    await ctx.reply(await fn(), { parse_mode: "HTML" });
  } catch (error) {
    if (isUnlinked(error)) {
      await sendUnlinked(ctx);
      return;
    }
    console.error("Bot handler error:", describeError(error));
    await ctx.reply("Xatolik yuz berdi. Keyinroq qayta urinib ko'ring.");
  }
}

type InlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

function mainMenu(kind: "user" | "driver"): InlineKeyboard {
  if (kind === "driver") {
    return {
      inline_keyboard: [
        [
          { text: "👤 Profil", callback_data: "d:profile" },
          { text: "🚌 Mashinam", callback_data: "d:vehicle" },
        ],
        [
          { text: "💰 Oylik plan", callback_data: "d:debt" },
          { text: "🧾 To'lovlarim", callback_data: "d:payments" },
        ],
        [
          { text: "💳 Masofaviy to'lov (Karta)", callback_data: "d:pay" },
        ],
        [
          { text: "🪪 Hujjatlarim", callback_data: "d:docs" },
          { text: "🔄 Yangilash", callback_data: "d:refresh" },
        ],
      ],
    };
  }
  return {
    inline_keyboard: [
      [
        { text: "👤 Profil", callback_data: "u:profile" },
        { text: "📄 Shartnomalar", callback_data: "u:contracts" },
      ],
      [
        { text: "💳 To'lovlar", callback_data: "u:payments" },
        { text: "📊 Qoldiq", callback_data: "u:balance" },
      ],
      [{ text: "🔄 Yangilash", callback_data: "u:profile" }],
    ],
  };
}

const STATUS_UZ: Record<string, string> = {
  DRAFT: "qoralama",
  ACTIVE: "faol",
  TERMINATED: "bekor qilingan",
  PENDING: "kutilmoqda",
  PAID: "to'langan",
  FAILED: "xato",
  CANCELLED: "bekor qilingan",
  MANUAL: "qo'lda",
  AUTOMATIC: "avtomatik",
  SELF_USE: "o'zida saqlash",
  LEASE: "ijara",
  SERVICE: "xizmat",
};

const METHOD_UZ: Record<string, string> = {
  CASH: "naqd",
  CARD: "plastik",
};

function vehicleLines(driver: BotDriver): string[] {
  if (!driver.vehicle) return ["🚌 Avtomobil biriktirilmagan"];
  return [
    `🚌 <b>${escapeHtml(driver.vehicle.plateNumber)}</b> · ${escapeHtml(driver.vehicle.model)}`,
    driver.vehicle.routeName ? `🛣 ${escapeHtml(driver.vehicle.routeName)}` : "",
  ];
}

function monthLines(driver: BotDriver): string[] {
  return [
    `📅 ${driver.month.period}`,
    `Oylik plan: <b>${money(driver.month.due)}</b>`,
    `To'langan: ${money(driver.month.paid)}`,
    `Shu oy qarzi: <b>${money(driver.month.debt)}</b>`,
    `Umumiy qarz: <b>${money(driver.totalDebt)}</b>`,
  ];
}

function driverText(driver: BotDriver): string {
  return [
    `<b>${escapeHtml(driver.fullName)}</b>`,
    driver.companyName ? escapeHtml(driver.companyName) : "",
    ...vehicleLines(driver),
    "",
    ...monthLines(driver),
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n");
}

function driverPaymentsText(driver: BotDriver): string {
  if (driver.payments.length === 0) {
    return `🧾 Hali to'lov yo'q.\nOylik plan: <b>${money(driver.month.due)}</b>`;
  }
  return [
    "<b>Oxirgi to'lovlar</b>",
    ...driver.payments.map(
      (payment) =>
        `${payment.paidAt.slice(0, 10)} — <b>${money(payment.amount)}</b> (${METHOD_UZ[payment.method] ?? payment.method}) · ${escapeHtml(payment.plateNumber)}`,
    ),
    "",
    `Shu oy qarzi: <b>${money(driver.month.debt)}</b>`,
  ].join("\n");
}

async function userProfileText(chatId: string): Promise<string> {
  const profile = await api.profile(chatId);
  const summary: BotSummary = await api.summary(chatId);
  return [
    `<b>${escapeHtml(profile.fullName)}</b>`,
    `${escapeHtml(profile.companyName)} (${escapeHtml(profile.companySlug)})`,
    `Faol shartnomalar: <b>${summary.activeContracts}</b>`,
    `Kutilayotgan to'lovlar: <b>${summary.pendingCount}</b> — ${money(summary.pendingAmount)}`,
    `Oxirgi 30 kun to'langan: ${money(summary.paidLast30Days)}`,
  ].join("\n");
}

// ---- Telegram profilini haydovchi profiliga qo'shish ----

async function profilePhotoId(ctx: Context, userId: number): Promise<string | undefined> {
  try {
    const photos = await ctx.telegram.getUserProfilePhotos(userId, 0, 1);
    const sizes = photos.photos[0];
    return sizes && sizes.length > 0 ? sizes[sizes.length - 1]!.file_id : undefined;
  } catch {
    return undefined;
  }
}

async function telegramProfile(ctx: Context): Promise<TelegramProfile> {
  const from = ctx.from;
  const profile: TelegramProfile = { chatId: chatIdOf(ctx) };
  if (!from) return profile;
  if (from.username) profile.username = from.username.slice(0, 64);
  if (from.first_name) profile.firstName = from.first_name.slice(0, 64);
  if (from.last_name) profile.lastName = from.last_name.slice(0, 64);
  const photo = await profilePhotoId(ctx, from.id);
  if (photo) profile.photoFileId = photo;
  return profile;
}

async function syncDriverProfile(ctx: Context): Promise<void> {
  try {
    await api.syncProfile(await telegramProfile(ctx));
  } catch (error) {
    console.error("Telegram profil sinxronlash xatosi:", describeError(error));
  }
}

// ---- Hujjatlar (passport, haydovchilik guvohnomasi) ----

interface FieldSpec {
  label: string;
  prompt: string;
  photo?: boolean;
}

const DOCUMENT_FIELDS: Record<DocumentField, FieldSpec> = {
  passportNumber: {
    label: "Passport raqami",
    prompt: "Passport seriya va raqamini yozing.\nMasalan: <code>AA1234567</code>",
  },
  passportIssuedBy: {
    label: "Kim bergan",
    prompt: "Passport kim tomonidan berilganini yozing.\nMasalan: <code>Toshkent sh. Chilonzor IIB</code>",
  },
  passportIssuedAt: {
    label: "Berilgan sana",
    prompt: "Passport berilgan sanani yozing.\nMasalan: <code>25.03.2020</code>",
  },
  pinfl: {
    label: "JSHSHIR",
    prompt: "JSHSHIR (PINFL) — 14 ta raqam.\nMasalan: <code>31234567890123</code>",
  },
  birthDate: {
    label: "Tug'ilgan sana",
    prompt: "Tug'ilgan sanangizni yozing.\nMasalan: <code>01.01.1985</code>",
  },
  passportPhotoFileId: {
    label: "📷 Passport rasmi",
    prompt: "Passportning ma'lumotlar sahifasini rasmga olib yuboring.",
    photo: true,
  },
  licenseNumber: {
    label: "Guvohnoma raqami",
    prompt: "Haydovchilik guvohnomasi raqamini yozing.\nMasalan: <code>AF1234567</code>",
  },
  licenseCategories: {
    label: "Toifalar",
    prompt: "Guvohnoma toifalarini yozing.\nMasalan: <code>B, C, D</code>",
  },
  licenseIssuedAt: {
    label: "Guvohnoma berilgan",
    prompt: "Guvohnoma berilgan sanani yozing.\nMasalan: <code>10.06.2018</code>",
  },
  licenseExpiresAt: {
    label: "Amal qilish muddati",
    prompt: "Guvohnoma amal qilish muddatini yozing.\nMasalan: <code>10.06.2028</code>",
  },
  licensePhotoFileId: {
    label: "📷 Guvohnoma rasmi",
    prompt: "Haydovchilik guvohnomasini rasmga olib yuboring.",
    photo: true,
  },
};

function isDocumentField(value: string): value is DocumentField {
  return Object.prototype.hasOwnProperty.call(DOCUMENT_FIELDS, value);
}

const PENDING_TTL_MS = 10 * 60_000;
const pendingInput = new Map<string, { field: DocumentField; expiresAt: number }>();

interface PendingReceiptSession {
  step: "WAITING_RECEIPT" | "WAITING_AMOUNT";
  buffer?: Buffer;
  filename?: string;
  expiresAt: number;
}
const pendingReceipts = new Map<string, PendingReceiptSession>();

function receiptSessionFor(chatId: string): PendingReceiptSession | null {
  const session = pendingReceipts.get(chatId);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    pendingReceipts.delete(chatId);
    return null;
  }
  return session;
}

function pendingFor(chatId: string): DocumentField | null {
  const pending = pendingInput.get(chatId);
  if (!pending) return null;
  if (pending.expiresAt < Date.now()) {
    pendingInput.delete(chatId);
    return null;
  }
  return pending.field;
}

function humanDate(value: string | null): string | null {
  if (!value) return null;
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function documentsText(docs: BotDocuments): string {
  const row = (label: string, value: string | null) =>
    `${label}: ${value ? `<b>${escapeHtml(value)}</b>` : "<i>kiritilmagan</i>"}`;
  const photo = (has: boolean) => (has ? "✅ yuklangan" : "<i>yo'q</i>");
  const expires = docs.license.expiresAt;
  const expired = expires !== null && new Date(`${expires}T23:59:59+05:00`).getTime() < Date.now();
  return [
    "🪪 <b>Passport</b>",
    row("Seriya va raqam", docs.passport.number),
    row("Kim bergan", docs.passport.issuedBy),
    row("Berilgan sana", humanDate(docs.passport.issuedAt)),
    row("JSHSHIR", docs.passport.pinfl),
    row("Tug'ilgan sana", humanDate(docs.passport.birthDate)),
    `Rasm: ${photo(docs.passport.hasPhoto)}`,
    "",
    "🚗 <b>Haydovchilik guvohnomasi</b>",
    row("Raqam", docs.license.number),
    row("Toifalar", docs.license.categories),
    row("Berilgan sana", humanDate(docs.license.issuedAt)),
    row("Amal qilish muddati", humanDate(expires)) + (expired ? " ⚠️ <b>muddati o'tgan</b>" : ""),
    `Rasm: ${photo(docs.license.hasPhoto)}`,
    "",
    "O'zgartirish uchun kerakli tugmani bosing.",
  ].join("\n");
}

function documentsKeyboard(): InlineKeyboard {
  const fields = Object.keys(DOCUMENT_FIELDS) as DocumentField[];
  const rows: InlineKeyboard["inline_keyboard"] = [];
  for (let index = 0; index < fields.length; index += 2) {
    rows.push(
      fields.slice(index, index + 2).map((field) => ({
        text: `✏️ ${DOCUMENT_FIELDS[field].label}`,
        callback_data: `doc:${field}`,
      })),
    );
  }
  rows.push([{ text: "⬅️ Menyu", callback_data: "d:profile" }]);
  return { inline_keyboard: rows };
}

const CANCEL_KEYBOARD: InlineKeyboard = {
  inline_keyboard: [[{ text: "✖️ Bekor qilish", callback_data: "doc:cancel" }]],
};

async function showDocuments(ctx: Context, prefix?: string): Promise<void> {
  const docs = await api.documents(chatIdOf(ctx));
  await ctx.reply(prefix ? `${prefix}\n\n${documentsText(docs)}` : documentsText(docs), {
    parse_mode: "HTML",
    reply_markup: documentsKeyboard(),
  });
}

async function saveDocument(ctx: Context, field: DocumentField, value: string): Promise<void> {
  const chatId = chatIdOf(ctx);
  try {
    await api.updateDocument(chatId, field, value);
    pendingInput.delete(chatId);
    await showDocuments(ctx, `✅ ${DOCUMENT_FIELDS[field].label.replace("📷 ", "")} saqlandi.`);
  } catch (error) {
    if (isUnlinked(error)) {
      pendingInput.delete(chatId);
      await sendUnlinked(ctx);
      return;
    }
    if (error instanceof ApiError && error.status === 400) {
      await ctx.reply(`⚠️ ${escapeHtml(error.message)}\n\nQaytadan yuboring:`, {
        parse_mode: "HTML",
        reply_markup: CANCEL_KEYBOARD,
      });
      return;
    }
    throw error;
  }
}

// ---- Asosiy menyu ----

async function sendDriverHome(ctx: Context, prefix?: string): Promise<void> {
  const driver = await api.driver(chatIdOf(ctx));
  await ctx.reply(prefix ? `${prefix}\n\n${driverText(driver)}` : driverText(driver), {
    parse_mode: "HTML",
    reply_markup: mainMenu("driver"),
  });
}

bot.start(async (ctx) => {
  const payload = ctx.startPayload?.trim();
  if (!payload) {
    try {
      const who = await api.whoami(chatIdOf(ctx));
      if (who.kind === "driver") {
        void syncDriverProfile(ctx);
        await sendDriverHome(ctx);
        return;
      }
      await ctx.reply(`Assalomu alaykum, <b>${escapeHtml(who.fullName)}</b>!`, {
        parse_mode: "HTML",
        reply_markup: mainMenu("user"),
      });
    } catch (error) {
      if (!isUnlinked(error)) console.error("start error:", describeError(error));
      await sendUnlinked(ctx);
    }
    return;
  }

  try {
    const result = await api.link(payload, chatIdOf(ctx), ctx.from?.username);
    const header = `✅ Akkaunt bog'landi.\n${escapeHtml(result.fullName)} — ${escapeHtml(result.companyName)}`;
    if (result.kind === "driver") {
      await syncDriverProfile(ctx);
      await ctx.reply(header, { parse_mode: "HTML", reply_markup: { remove_keyboard: true } });
      await sendDriverHome(ctx);
      return;
    }
    await ctx.reply(header, { parse_mode: "HTML", reply_markup: mainMenu("user") });
  } catch (error) {
    if (error instanceof ApiError) {
      await sendUnlinked(ctx, `⚠️ ${escapeHtml(error.message)}`);
      return;
    }
    console.error(describeError(error));
    await ctx.reply("Bog'lashda xatolik yuz berdi.");
  }
});

bot.on(message("contact"), async (ctx) => {
  const contact = ctx.message.contact;
  if (contact.user_id !== ctx.from.id) {
    await ctx.reply(
      "Faqat o'zingizning raqamingizni yuboring — pastdagi <b>📱 Telefon raqamni yuborish</b> tugmasini bosing.",
      { parse_mode: "HTML", reply_markup: CONTACT_KEYBOARD },
    );
    return;
  }
  try {
    const profile = await telegramProfile(ctx);
    const result = await api.linkPhone({ ...profile, phone: contact.phone_number });
    pendingInput.delete(chatIdOf(ctx));
    await ctx.reply(
      `✅ Ro'yxatdan o'tdingiz!\n<b>${escapeHtml(result.fullName)}</b> — ${escapeHtml(result.companyName)}`,
      { parse_mode: "HTML", reply_markup: { remove_keyboard: true } },
    );
    await sendDriverHome(ctx);
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) {
      await ctx.reply(`⚠️ ${escapeHtml(error.message)}`, {
        parse_mode: "HTML",
        reply_markup: CONTACT_KEYBOARD,
      });
      return;
    }
    console.error("link-phone error:", describeError(error));
    await ctx.reply("Ro'yxatdan o'tishda xatolik. Birozdan so'ng qayta urinib ko'ring.", {
      reply_markup: CONTACT_KEYBOARD,
    });
  }
});

bot.command("menu", async (ctx) => {
  try {
    const who = await api.whoami(chatIdOf(ctx));
    await ctx.reply("Menyu:", { reply_markup: mainMenu(who.kind) });
  } catch {
    await sendUnlinked(ctx);
  }
});

bot.command("profil", async (ctx) => {
  try {
    const who = await api.whoami(chatIdOf(ctx));
    if (who.kind === "driver") {
      await sendDriverHome(ctx);
      return;
    }
  } catch (error) {
    if (isUnlinked(error)) {
      await sendUnlinked(ctx);
      return;
    }
    throw error;
  }
  await safeReply(ctx, () => userProfileText(chatIdOf(ctx)));
});

async function driverOnly(ctx: Context, fn: () => Promise<void>, failText: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (isUnlinked(error)) {
      await sendUnlinked(ctx);
      return;
    }
    console.error(describeError(error));
    await ctx.reply(failText);
  }
}

bot.command("mashina", (ctx) =>
  driverOnly(ctx, () => sendDriverHome(ctx), "Ma'lumot olishda xatolik."),
);

bot.command("qarz", (ctx) =>
  driverOnly(
    ctx,
    async () => {
      const driver = await api.driver(chatIdOf(ctx));
      await ctx.reply(
        [...monthLines(driver), "", "Qarz har oy yig'iladi — o'tgan oylar qarzi saqlanadi."].join("\n"),
        { parse_mode: "HTML", reply_markup: mainMenu("driver") },
      );
    },
    "Qarz ma'lumotini olishda xatolik.",
  ),
);

bot.command("hujjatlar", (ctx) =>
  driverOnly(ctx, () => showDocuments(ctx), "Hujjatlarni olishda xatolik."),
);

bot.command("shartnomalar", (ctx) =>
  safeReply(ctx, async () => {
    const { items } = await api.contracts(chatIdOf(ctx));
    if (items.length === 0) return "Shartnomalar topilmadi.";
    return items
      .slice(0, 10)
      .map((contract) =>
        [
          `<b>${escapeHtml(contract.vehicle.plateNumber)}</b> — ${escapeHtml(contract.vehicle.model)}`,
          `${STATUS_UZ[contract.type] ?? contract.type}, ${STATUS_UZ[contract.status] ?? contract.status}`,
          contract.monthlyRate
            ? `Oylik: ${money(contract.monthlyRate)}`
            : "Oylik to'lov yo'q",
        ].join("\n"),
      )
      .join("\n\n");
  }),
);

bot.command("tolovlar", async (ctx) => {
  try {
    const who = await api.whoami(chatIdOf(ctx));
    if (who.kind === "driver") {
      const driver = await api.driver(chatIdOf(ctx));
      await ctx.reply(driverPaymentsText(driver), {
        parse_mode: "HTML",
        reply_markup: mainMenu("driver"),
      });
      return;
    }
  } catch (error) {
    if (isUnlinked(error)) {
      await sendUnlinked(ctx);
      return;
    }
    throw error;
  }
  await safeReply(ctx, async () => {
    const { items } = await api.payments(chatIdOf(ctx));
    if (items.length === 0) return "To'lovlar topilmadi.";
    return items
      .slice(0, 10)
      .map(
        (payment) =>
          `${payment.createdAt.slice(0, 10)} — <b>${money(payment.amount)}</b> — ${
            STATUS_UZ[payment.status] ?? payment.status
          } (${escapeHtml(payment.plateNumber)})`,
      )
      .join("\n");
  });
});

bot.command("balans", (ctx) =>
  safeReply(ctx, async () => {
    const balance = await api.balance(chatIdOf(ctx));
    return balance.pendingCount === 0
      ? "Kutilayotgan to'lov yo'q. Qoldiq: 0.00 so'm."
      : `Kutilayotgan to'lov: <b>${money(balance.pendingAmount)}</b> (${balance.pendingCount} ta).`;
  }),
);

bot.command("yordam", (ctx) =>
  ctx.reply(
    [
      "Buyruqlar:",
      "/menu — tugmali menyu",
      "/profil — profil",
      "/qarz — oylik plan va qarz (haydovchi)",
      "/mashina — biriktirilgan avtomobil (haydovchi)",
      "/hujjatlar — passport va guvohnoma (haydovchi)",
      "/shartnomalar — shartnomalar (xodim)",
      "/tolovlar — oxirgi to'lovlar",
      "/balans — kutilayotgan to'lov (xodim)",
      "",
      "Ro'yxatdan o'tish: /start → «📱 Telefon raqamni yuborish» tugmasi.",
    ].join("\n"),
  ),
);

bot.on(message("photo"), async (ctx) => {
  const chatId = chatIdOf(ctx);

  // Masofaviy to'lov cheki yuborilayotgan bo'lsa
  const receiptSession = receiptSessionFor(chatId);
  if (receiptSession && receiptSession.step === "WAITING_RECEIPT") {
    const sizes = ctx.message.photo;
    const largest = sizes[sizes.length - 1];
    if (!largest) return;

    try {
      const fileLink = await ctx.telegram.getFileLink(largest.file_id);
      const res = await fetch(fileLink.href);
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const captionText = ctx.message.caption?.replace(/\s+/g, "").trim() || "";
      if (/^\d{3,10}$/.test(captionText)) {
        pendingReceipts.delete(chatId);
        await ctx.reply("⏳ Chek AI xavfsizlik tizimi tomonidan tekshirilmoqda...");
        const result = await api.submitReceipt(
          chatId,
          captionText,
          buffer.toString("base64"),
          "receipt.jpg",
        );
        const riskNote =
          result.fraudRisk === "HIGH"
            ? "\n⚠️ <i>Diqqat: Chekda tahrir belgilari aniqlandi va qo'shimcha tekshiruvga yuborildi.</i>"
            : "";
        await ctx.reply(
          `✅ <b>To'lov cheki qabul qilindi!</b>\nSumma: <b>${money(result.amount)}</b>\nHolat: Kutilmoqda (Admin tasdiqlashi kerak)${riskNote}\n\nMas'ul xodim hisobga pul tushganini tekshirib tasdiqlagach, to'lov hisobingizga tushadi.`,
          { parse_mode: "HTML", reply_markup: mainMenu("driver") },
        );
        return;
      }

      pendingReceipts.set(chatId, {
        step: "WAITING_AMOUNT",
        buffer,
        filename: "receipt.jpg",
        expiresAt: Date.now() + PENDING_TTL_MS,
      });
      await ctx.reply(
        "✅ Chek rasmi qabul qilindi!\n\nIltimos, to'lagan summani raqamda yozib yuboring (masalan: <code>50000</code>):",
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{ text: "❌ Bekor qilish", callback_data: "pay:cancel" }]],
          },
        },
      );
      return;
    } catch (err) {
      console.error("Receipt upload error:", err);
      await ctx.reply("Rasmni yuklashda xatolik yuz berdi. Qaytadan urinib ko'ring.");
      return;
    }
  }

  const field = pendingFor(chatId);
  if (!field || !DOCUMENT_FIELDS[field].photo) {
    await ctx.reply(
      "Rasmni hujjatga qo'shish uchun 🪪 Hujjatlarim bo'limiga, to'lov cheki uchun esa 💳 Masofaviy to'lov bo'limiga o'ting.",
    );
    return;
  }
  const sizes = ctx.message.photo;
  const largest = sizes[sizes.length - 1];
  if (!largest) return;
  await driverOnly(ctx, () => saveDocument(ctx, field, largest.file_id), "Rasmni saqlashda xatolik.");
});

bot.on(message("document"), async (ctx) => {
  const chatId = chatIdOf(ctx);
  const field = pendingFor(chatId);
  const doc = ctx.message.document;
  if (!field || !DOCUMENT_FIELDS[field].photo) {
    await ctx.reply("Fayl qabul qilinmadi. Hujjat rasmini 🪪 Hujjatlarim bo'limi orqali yuboring.");
    return;
  }
  if (!doc.mime_type?.startsWith("image/")) {
    await ctx.reply("Faqat rasm (JPG/PNG) yuboring.", { reply_markup: CANCEL_KEYBOARD });
    return;
  }
  await driverOnly(ctx, () => saveDocument(ctx, field, doc.file_id), "Rasmni saqlashda xatolik.");
});

const PHONE_LIKE = /^\+?[\d\s()-]{9,20}$/;

bot.on(message("text"), async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) {
    await ctx.reply("Noma'lum buyruq. /yordam — buyruqlar ro'yxati.");
    return;
  }
  const chatId = chatIdOf(ctx);

  const receiptSession = receiptSessionFor(chatId);
  if (receiptSession) {
    if (receiptSession.step === "WAITING_AMOUNT") {
      const cleanNum = text.replace(/\s+/g, "").replace(",", ".");
      const amount = Number(cleanNum);
      if (isNaN(amount) || amount <= 0 || amount > 100_000_000) {
        await ctx.reply(
          "⚠️ Iltimos, to'g'ri summa kiriting (masalan: <code>50000</code> yoki <code>100000</code>):",
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "❌ Bekor qilish", callback_data: "pay:cancel" }]],
            },
          },
        );
        return;
      }

      if (!receiptSession.buffer) {
        pendingReceipts.delete(chatId);
        await ctx.reply("Chek rasmi topilmadi. Qaytadan boshlang.", {
          reply_markup: mainMenu("driver"),
        });
        return;
      }

      const receiptBuffer = receiptSession.buffer;
      const receiptFilename = receiptSession.filename || "receipt.jpg";
      pendingReceipts.delete(chatId);

      await ctx.reply("⏳ Chek AI xavfsizlik tizimi tomonidan tahlil qilinmoqda...");
      try {
        const result = await api.submitReceipt(
          chatId,
          String(amount),
          receiptBuffer.toString("base64"),
          receiptFilename,
        );
        const riskNote =
          result.fraudRisk === "HIGH"
            ? "\n\n⚠️ <i>Diqqat: Chekda tahrir yoki shubhali belgilar aniqlandi va ma'muriyatning maxsus tekshiruviga yo'naltirildi.</i>"
            : "";
        await ctx.reply(
          `✅ <b>To'lov cheki qabul qilindi!</b>\nSumma: <b>${money(result.amount)}</b>\nHolat: <b>Kutilmoqda (Admin tasdiqlashi kerak)</b>${riskNote}\n\nMas'ul xodim hisobga pul tushganini tekshirib tasdiqlagach, to'lov balansingizga kiritiladi.`,
          { parse_mode: "HTML", reply_markup: mainMenu("driver") },
        );
      } catch (err) {
        console.error("Submit receipt text error:", describeError(err));
        await ctx.reply("Chekni yuborishda xatolik yuz berdi. Qaytadan urinib ko'ring.", {
          reply_markup: mainMenu("driver"),
        });
      }
      return;
    }

    if (receiptSession.step === "WAITING_RECEIPT") {
      await ctx.reply(
        "📷 Iltimos, to'lov chekining rasmini (skrinshotini) yuboring.\n\nAgar bekor qilmoqchi bo'lsangiz:",
        {
          reply_markup: {
            inline_keyboard: [[{ text: "❌ Bekor qilish", callback_data: "pay:cancel" }]],
          },
        },
      );
      return;
    }
  }

  const field = pendingFor(chatId);
  if (field) {
    if (DOCUMENT_FIELDS[field].photo) {
      await ctx.reply("Bu maydon uchun matn emas, rasm yuboring.", {
        reply_markup: CANCEL_KEYBOARD,
      });
      return;
    }
    await driverOnly(ctx, () => saveDocument(ctx, field, text), "Saqlashda xatolik.");
    return;
  }
  try {
    const who = await api.whoami(chatId);
    await ctx.reply("Menyu:", { reply_markup: mainMenu(who.kind) });
  } catch (error) {
    if (!isUnlinked(error)) {
      console.error(describeError(error));
      await ctx.reply("Xatolik yuz berdi. Keyinroq qayta urinib ko'ring.");
      return;
    }
    await sendUnlinked(
      ctx,
      PHONE_LIKE.test(text)
        ? "Raqamni yozish shart emas — xavfsizlik uchun pastdagi tugma orqali yuboring."
        : undefined,
    );
  }
});

bot.on("callback_query", async (ctx) => {
  const data =
    ctx.callbackQuery && "data" in ctx.callbackQuery
      ? ctx.callbackQuery.data
      : undefined;
  await ctx.answerCbQuery();
  if (!data) return;
  const chatId = chatIdOf(ctx);

  try {
    if (data === "pay:cancel") {
      pendingReceipts.delete(chatId);
      await ctx.reply("Masofaviy to'lov jarayoni bekor qilindi.", {
        reply_markup: mainMenu("driver"),
      });
      return;
    }
    if (data === "doc:cancel") {
      pendingInput.delete(chatId);
      await showDocuments(ctx);
      return;
    }
    if (data.startsWith("doc:")) {
      const field = data.slice(4);
      if (!isDocumentField(field)) return;
      await api.documents(chatId);
      pendingInput.set(chatId, { field, expiresAt: Date.now() + PENDING_TTL_MS });
      await ctx.reply(
        `${DOCUMENT_FIELDS[field].prompt}\n\n<i>Maydonni tozalash uchun</i> <code>-</code> <i>yuboring.</i>`,
        { parse_mode: "HTML", reply_markup: CANCEL_KEYBOARD },
      );
      return;
    }

    if (data.startsWith("d:")) {
      pendingInput.delete(chatId);
      if (data === "d:docs") {
        await showDocuments(ctx);
        return;
      }
      if (data === "d:pay") {
        try {
          const cardInfo = await api.paymentCard(chatId);
          if (!cardInfo.paymentCardNumber) {
            await ctx.reply(
              "ℹ️ Kompaniya tomonidan to'lov kartasi hali belgilanmagan. Iltimos, dispetcher yoki hisobchiga murojaat qiling.",
              { reply_markup: mainMenu("driver") },
            );
            return;
          }

          pendingReceipts.set(chatId, {
            step: "WAITING_RECEIPT",
            expiresAt: Date.now() + PENDING_TTL_MS,
          });

          const formattedCard = cardInfo.paymentCardNumber.replace(/(\d{4})/g, "$1 ").trim();
          const lines = [
            "💳 <b>Masofaviy to'lov (Karta orqali)</b>",
            "",
            `Karta raqami: <code>${formattedCard}</code>`,
            cardInfo.paymentCardHolder ? `Karta egasi: <b>${escapeHtml(cardInfo.paymentCardHolder)}</b>` : null,
            cardInfo.paymentCardBank ? `Bank: <b>${escapeHtml(cardInfo.paymentCardBank)}</b>` : null,
            cardInfo.paymentInstructions ? `\nKo'rsatma: <i>${escapeHtml(cardInfo.paymentInstructions)}</i>` : null,
            "",
            "📲 <i>Ilovangiz (Click, Payme, Uzum va h.k.) orqali yuqoridagi kartaga to'lovni bajaring.</i>",
            "📥 <b>To'lov qilgach, chek rasmini (yoki skrinshotini) shu yerga yuboring:</b>",
          ].filter(Boolean).join("\n");

          await ctx.reply(lines, {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "❌ Bekor qilish", callback_data: "pay:cancel" }]],
            },
          });
          return;
        } catch (err) {
          console.error("Payment card error:", describeError(err));
          await ctx.reply("Karta ma'lumotlarini olishda xatolik yuz berdi.");
          return;
        }
      }
      const driver = await api.driver(chatId);
      let text: string;
      switch (data) {
        case "d:vehicle":
          text = driver.vehicle
            ? [
                ...vehicleLines(driver).filter(Boolean),
                `Oylik plan: <b>${money(driver.vehicle.monthlyFee)}</b>`,
                "",
                "Avtomobil o'zgarsa, administratsiya yangilaydi.",
              ].join("\n")
            : "Sizga hali avtomobil biriktirilmagan. Administratsiyaga murojaat qiling.";
          break;
        case "d:debt":
          text = [
            ...monthLines(driver),
            "",
            "To'lovni har kuni chiqishdan oldin naqd yoki plastik bilan qilishingiz mumkin.",
          ].join("\n");
          break;
        case "d:payments":
          text = driverPaymentsText(driver);
          break;
        default:
          text = driverText(driver);
          break;
      }
      await ctx.reply(text, {
        parse_mode: "HTML",
        reply_markup: mainMenu("driver"),
      });
      return;
    }

    if (data.startsWith("u:")) {
      let text: string;
      switch (data) {
        case "u:contracts": {
          const { items } = await api.contracts(chatId);
          text =
            items.length === 0
              ? "Shartnomalar topilmadi."
              : items
                  .slice(0, 10)
                  .map(
                    (contract) =>
                      `<b>${escapeHtml(contract.vehicle.plateNumber)}</b> — ${escapeHtml(contract.vehicle.model)}\n${STATUS_UZ[contract.type] ?? contract.type}, ${STATUS_UZ[contract.status] ?? contract.status}`,
                  )
                  .join("\n\n");
          break;
        }
        case "u:payments": {
          const { items } = await api.payments(chatId);
          text =
            items.length === 0
              ? "To'lovlar topilmadi."
              : items
                  .slice(0, 10)
                  .map(
                    (payment) =>
                      `${payment.createdAt.slice(0, 10)} — <b>${money(payment.amount)}</b> — ${STATUS_UZ[payment.status] ?? payment.status} (${escapeHtml(payment.plateNumber)})`,
                  )
                  .join("\n");
          break;
        }
        case "u:balance": {
          const balance = await api.balance(chatId);
          text =
            balance.pendingCount === 0
              ? "Kutilayotgan to'lov yo'q. Qoldiq: 0.00 so'm."
              : `Kutilayotgan to'lov: <b>${money(balance.pendingAmount)}</b> (${balance.pendingCount} ta).`;
          break;
        }
        default:
          text = await userProfileText(chatId);
          break;
      }
      await ctx.reply(text, {
        parse_mode: "HTML",
        reply_markup: mainMenu("user"),
      });
      return;
    }
  } catch (error) {
    if (isUnlinked(error)) {
      pendingInput.delete(chatId);
      await sendUnlinked(ctx);
      return;
    }
    console.error("Bot callback error:", describeError(error));
    await ctx.reply("Xatolik yuz berdi. Keyinroq qayta urinib ko'ring.");
  }
});

bot.catch((error) => {
  console.error("Bot polling error:", describeError(error));
});

function describeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return token ? raw.split(token).join("<token>") : raw;
}

const LAUNCH_ATTEMPTS = 6;

function startPolling(attempt = 1): void {
  // Telegraf launch() resolves only when polling stops, so readiness is
  // reported by the onLaunch callback and startup errors by the rejection.
  bot
    .launch({ allowedUpdates: ["message", "callback_query"] }, () => {
      console.log("Telegram bot started (long polling).");
      void bot.telegram
        .setMyCommands([
          { command: "start", description: "Boshlash / ro'yxatdan o'tish" },
          { command: "menu", description: "Tugmali menyu" },
          { command: "qarz", description: "Oylik plan va qarz" },
          { command: "tolovlar", description: "Oxirgi to'lovlar" },
          { command: "hujjatlar", description: "Passport va guvohnoma" },
          { command: "yordam", description: "Yordam" },
        ])
        .catch((error) => console.error("setMyCommands:", describeError(error)));
    })
    .then(() => {
      console.log("Telegram bot polling stopped.");
    })
    .catch(async (error) => {
      console.error(
        `Bot launch ${attempt}/${LAUNCH_ATTEMPTS} failed: ${describeError(error)}`,
      );
      if (attempt >= LAUNCH_ATTEMPTS) {
        console.error("Bot ishga tushmadi, jarayon to'xtatildi.");
        process.exit(1);
      }
      const delay = Math.min(30_000, 2_000 * 2 ** (attempt - 1));
      await new Promise((resolve) => setTimeout(resolve, delay));
      startPolling(attempt + 1);
    });
}

function main(): void {
  const stop = (signal: string) => {
    console.log(`Bot stopping (${signal})...`);
    bot.stop(signal);
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));

  startPolling();
}

main();
