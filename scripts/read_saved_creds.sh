#!/bin/bash
cd /opt/uyushma/app/apps/api
node -e '
const fs = require("fs");
const dotenv = require("dotenv");
const crypto = require("crypto");
const envConfig = dotenv.parse(fs.readFileSync("/opt/uyushma/.env"));
const appKey = envConfig.APP_ENCRYPTION_KEY;

function parseKey(raw) {
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch {}
  return crypto.createHmac("sha256", "uyushmachilar-envelope").update(raw).digest();
}

const key = parseKey(appKey);

function decrypt(payload) {
  const parts = payload.split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"));
  decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
}

const { Client } = require("pg");
const client = new Client({ connectionString: envConfig.DATABASE_URL });
client.connect().then(async () => {
  const res = await client.query("SELECT id, \"tenantId\", provider, \"credentialsEncrypted\" FROM \"ExternalConnection\" WHERE \"credentialsEncrypted\" IS NOT NULL");
  for (const row of res.rows) {
    try {
      const dec = decrypt(row.credentialsEncrypted);
      console.log("Provider:", row.provider, "Tenant:", row.tenantId, "Decrypted:", dec);
    } catch(e) {
      console.log("Failed to decrypt for", row.provider, e.message);
    }
  }
  await client.end();
});
'
