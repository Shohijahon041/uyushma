import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** Signature covers both the timestamp and raw body to prevent replay. */
export function signWebhookPayload(
  rawBody: string,
  timestamp: string,
  secret: string,
): string {
  return `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")}`;
}

export function verifyWebhookSignature(input: {
  rawBody: string;
  timestamp: string;
  signature: string;
  secret: string;
  nowSeconds?: number;
}): boolean {
  if (!/^\d{1,12}$/.test(input.timestamp)) return false;
  const timestamp = Number(input.timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false;

  if (!input.signature.startsWith("sha256=")) return false;
  const providedHex = input.signature.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(providedHex)) return false;

  const expected = signWebhookPayload(input.rawBody, input.timestamp, input.secret);
  const expectedHex = expected.slice("sha256=".length);
  const a = Buffer.from(providedHex.toLowerCase(), "hex");
  const b = Buffer.from(expectedHex, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
