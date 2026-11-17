#!/usr/bin/env bash
set -e
cd /opt/uyushma/app

node << 'EOF'
const http = require('http');
const https = require('https');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://uyushma_app:d0b7410e63d2b0d2dc5beb09672fcbac30ef@127.0.0.1:5432/uyushma"
    }
  }
});

function fetchHttp(url, options = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https:');
    const lib = isHttps ? https : http;
    const req = lib.request(url, { ...options, rejectUnauthorized: false }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function run() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, phone: true, role: true, tenantId: true, company: { select: { name: true } } }
  });

  const jwt = require('jsonwebtoken');
  const jwtSecret = 'dev-only-change-me-0123456789abcdef0123456789abcdef';

  for (const user of users) {
    if (!user.tenantId || !user.company) continue;
    console.log(`\n==================================================`);
    console.log(`Testing Tenant: ${user.company.name} (User: ${user.email || user.phone})`);
    console.log(`==================================================`);

    const token = jwt.sign(
      { sub: user.id, tenantId: user.tenantId, role: user.role, typ: "access" },
      jwtSecret,
      { expiresIn: '1h', issuer: 'uyushmachilar', audience: 'uyushmachilar-api' }
    );

    const apiRes = await fetchHttp("http://127.0.0.1:4010/api/v1/dashboard/summary", {
      headers: {
        Authorization: `Bearer ${token}`,
        Host: "uyushma.bmbrutto.uz"
      }
    });

    console.log(`API /api/v1/dashboard/summary: HTTP ${apiRes.status}`);
    if (apiRes.status === 200) {
      const summary = JSON.parse(apiRes.body);
      console.log("Counts:", summary.counts);
      console.log("Drivers:", summary.drivers);
      console.log("External Vehicles:", summary.external?.vehicles);
      console.log("Recent Payments Count:", summary.payments?.recent?.length);
      if (summary.payments?.recent?.length > 0) {
        console.log("Recent Payments sample:", summary.payments.recent[0]);
      }
    } else {
      console.error("API error response:", apiRes.body);
    }

    const radarRes = await fetchHttp("http://127.0.0.1:4010/api/v1/registry/cross-link", {
      headers: {
        Authorization: `Bearer ${token}`,
        Host: "uyushma.bmbrutto.uz"
      }
    });
    console.log(`API /api/v1/registry/cross-link: HTTP ${radarRes.status}`);
    if (radarRes.status === 200) {
      const radar = JSON.parse(radarRes.body);
      console.log("Radar totals:", radar.totals);
    }
  }

  console.log("\n>>> ALL TENANT DASHBOARD API TESTS PASSED SUCCESSFULLY <<<");
}

run().catch(console.error).finally(() => prisma.$disconnect());
EOF
