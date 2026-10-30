const { execFileSync } = require("node:child_process");
const path = require("node:path");
const dotenv = require("dotenv");

module.exports = async function globalSetup() {
  dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

  const testUrl = process.env.TEST_DATABASE_URL;
  const testMigrateUrl = process.env.TEST_MIGRATE_DATABASE_URL;

  if (!testUrl || !testMigrateUrl) {
    throw new Error(
      "TEST_DATABASE_URL va TEST_MIGRATE_DATABASE_URL kerak. docker compose up -d postgres",
    );
  }

  const prismaPackage = require.resolve("prisma/package.json");
  const prismaCli = path.join(path.dirname(prismaPackage), "build/index.js");

  console.log("Applying migrations to the integration test database...");
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: testUrl,
      MIGRATE_DATABASE_URL: testMigrateUrl,
    },
    stdio: "inherit",
  });
};
