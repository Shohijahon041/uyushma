import {
  signWebhookPayload,
  verifyWebhookSignature,
} from "./webhook-signature";

const secret = "unit-test-secret-0123456789abcdef";
const rawBody = JSON.stringify({ eventId: "evt_1", paymentId: "p1" });
const now = 1_800_000_000;

describe("webhook signature", () => {
  it("accepts a valid signature", () => {
    const timestamp = String(now);
    const signature = signWebhookPayload(rawBody, timestamp, secret);
    expect(
      verifyWebhookSignature({ rawBody, timestamp, signature, secret, nowSeconds: now }),
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const timestamp = String(now);
    const signature = signWebhookPayload(rawBody, timestamp, secret);
    expect(
      verifyWebhookSignature({
        rawBody: rawBody.replace("p1", "p2"),
        timestamp,
        signature,
        secret,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it("rejects a stale timestamp", () => {
    const timestamp = String(now - 301);
    const signature = signWebhookPayload(rawBody, timestamp, secret);
    expect(
      verifyWebhookSignature({ rawBody, timestamp, signature, secret, nowSeconds: now }),
    ).toBe(false);
  });

  it("rejects malformed signatures", () => {
    expect(
      verifyWebhookSignature({
        rawBody,
        timestamp: String(now),
        signature: "sha256=not-hex",
        secret,
        nowSeconds: now,
      }),
    ).toBe(false);
  });
});
