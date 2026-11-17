#!/bin/bash
cd /opt/uyushma/app/apps/api
node -r dotenv/config dist/modules/external/scripts/sync-all.js --dotenv_config_path=/opt/uyushma/.env || node -e '
require("dotenv").config({ path: "/opt/uyushma/.env" });
const { NestFactory } = require("@nestjs/core");
const { AppModule } = require("./dist/app.module");
const { ExternalService } = require("./dist/modules/external/external.service");

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const externalService = app.get(ExternalService);
  const tenantId = "708fec3c-dc54-4a8f-ac4d-64bb91e42501";
  
  for (const prov of ["ETENDER", "IJARA", "AUTOPARK"]) {
    console.log(`\n=== Sinxronlash boshlanmoqda: ${prov} ===`);
    try {
      const res = await externalService.syncConnection(tenantId, prov);
      console.log(`[SUCCESS] ${prov}:`, JSON.stringify(res));
    } catch(err) {
      console.error(`[ERROR] ${prov}:`, err.message);
    }
  }
  await app.close();
}
run();
'
