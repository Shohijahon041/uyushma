#!/bin/bash
cat << 'EOF' > /tmp/test_etender_token.js
const fs = require("fs");
const crypto = require("crypto");
const https = require("https");

const content = fs.readFileSync("/opt/uyushma/.env", "utf8");
let appKey = "";
for (const line of content.split("\n")) {
  if (line.startsWith("APP_ENCRYPTION_KEY=")) {
    appKey = line.split("=")[1].trim().replace(/^["']|["']$/g, "");
  }
}
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

const { execSync } = require("child_process");
const raw = execSync('sudo -u postgres psql -d uyushma -t -A -c "SELECT \\"tokenEncrypted\\" FROM \\"ExternalConnection\\" WHERE \\"tenantId\\" = \'708fec3c-dc54-4a8f-ac4d-64bb91e42501\' AND provider = \'ETENDER\';"').toString().trim();

if (!raw) {
  console.log("No token found for ETENDER CARLUX");
  process.exit(0);
}

const token = decrypt(raw);
console.log("Decrypted token prefix:", token.slice(0, 25));

const req = https.request("https://e-tenderapi.uztrans.uz/api/user/get-cars", {
  method: "GET",
  headers: {
    "Authorization": "Bearer " + token.replace(/^Bearer\s+/i, "").trim()
  }
}, (res) => {
  let body = "";
  res.on("data", (chunk) => body += chunk);
  res.on("end", () => {
    console.log("Status:", res.statusCode);
    console.log("Body:", body.slice(0, 300));
  });
});
req.on("error", (e) => console.error("Error:", e));
req.end();
EOF
node /tmp/test_etender_token.js
rm -f /tmp/test_etender_token.js

