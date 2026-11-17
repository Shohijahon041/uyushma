#!/bin/bash
cd /opt/uyushma/app
node -e '
const fs = require("fs");
const crypto = require("crypto");
const content = fs.readFileSync("/opt/uyushma/.env", "utf8");
let appKey = "";
for (const line of content.split("\n")) {
  if (line.startsWith("APP_ENCRYPTION_KEY=")) {
    appKey = line.split("=")[1].trim().replace(/^["'\''']|["'\''']$/g, "");
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
const ciphertext = "v1.nl_lFszzRCwRxtYI.FVjCegVVf1EqVUHDwsGXJA.tVfF-6NB_TTPY1kZH7l4-IwAFJ7xNfioKrmQt6ExdQAxNPrRojjCKd6bjVuvAN3AJPeOGxq7WbSWMiIGYnZswQ336twoqd-b9s1i-ttxkMTs07dQn7uKm4W1Dae0ShFuxTFOgKjdU8j2WmLls7Nzix1Lw1HPekC8FCsK8XpqeTyNCdteAT1EEkS5UJXs-Qp49EuE8VkiSmfFEQLhG91lCuPoLgN5cDbePD6-roIMDhehT4MxBLK6tDvhXlFhgETC-h2jWViHVGxB9IkTGbTTEry2rISM2SpZvUMH6OKFtojQ3rast0RPeFFIcGGoIE0SSnfWoj0AZBpEU1_RvfqUlh3gi5ph4Si3uRBhXuwNtHfn2awyGCn8p611VNZfGHeSkdYGjShvh1mL3Uxy4LQEPmk2B4rM5yC2t9vHY7fK_AxIojR4Ima2GzUj5zkGGpHwr6diAb6-ZFp-gGIcy7EgOdShgt2kZRQQjHLeI-hRfxeiTITyVKkqZoir2CdZpM-1_1lteR8nI27cSifWm35RWEgDbsdN_MU5x0HBqJD1YpdoGaOjNlH6rSmqheM90OI68lIIThBzt-2-Y4LUg_0kc_x9KKJWLN0lnJCG068u1wYbyvUV4MeXTCOR8g-OJhDyZNDT0Dfd87VFB4h1On2YYeUIZ3IdI2JAfdFAaCXC5hP9K6s4R1s3Ptb9-kXLkVsjObZKTIi_wFqF23RbEVjTOmdehFi6Ohm4YFUBxQ0TkwxAJHd_E5fT6FUrMFQ3ZQRLIld7fcvCl7j0Ox_Beg0Iqn4vtAsUeUXsF7zIG4ooOzhwJmlN89PwZy1W1GgxrVBj6e8d_M5O7yG62u8WjQ8d9V-JBUMN";

const parts = ciphertext.split(".");
const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"));
decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
const plain = Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
console.log("Decrypted length:", plain.length);
try {
  const obj = JSON.parse(plain);
  console.log("Keys:", Object.keys(obj));
  if (obj.refreshToken) console.log("Has refreshToken! Length:", obj.refreshToken.length);
  if (obj.username) console.log("Has username:", obj.username);
} catch(e) {
  console.log("Not JSON, string:", plain.slice(0, 100));
}
'

