#!/usr/bin/env bash
set -e
cd /opt/uyushma/app

node << 'EOF'
const https = require('https');
const jwt = require('jsonwebtoken');

function fetchHttps(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { ...options, rejectUnauthorized: false }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function testBffProxy() {
  const jwtSecret = 'dev-only-change-me-0123456789abcdef0123456789abcdef';
  const token = jwt.sign(
    {
      sub: '7751796b-8ee0-4e4b-b4dc-66bca6904b8e',
      tenantId: '708fec3c-dc54-4a8f-ac4d-64bb91e42501',
      role: 'OWNER',
      typ: 'access'
    },
    jwtSecret,
    { expiresIn: '1h', issuer: 'uyushmachilar', audience: 'uyushmachilar-api' }
  );

  console.log("=== Testing BFF /api/proxy/dashboard/summary ===");
  const res = await fetchHttps("https://127.0.0.1/api/proxy/dashboard/summary", {
    headers: {
      Host: "uyushma.bmbrutto.uz",
      Cookie: `uy_at=${token}`
    }
  });

  console.log(`BFF Proxy Status: HTTP ${res.status}`);
  if (res.status === 200) {
    console.log("BFF Proxy Summary Body:", res.body.slice(0, 300) + "...");
  } else {
    console.error("BFF Proxy Error:", res.body);
  }

  console.log("\n=== Testing BFF /api/proxy/registry/cross-link ===");
  const radarRes = await fetchHttps("https://127.0.0.1/api/proxy/registry/cross-link", {
    headers: {
      Host: "uyushma.bmbrutto.uz",
      Cookie: `uy_at=${token}`
    }
  });

  console.log(`BFF Proxy Radar Status: HTTP ${radarRes.status}`);
  if (radarRes.status === 200) {
    console.log("BFF Proxy Radar Body:", radarRes.body.slice(0, 300) + "...");
  } else {
    console.error("BFF Proxy Radar Error:", radarRes.body);
  }
}

testBffProxy().catch(console.error);
EOF
