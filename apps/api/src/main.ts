import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./bootstrap";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    rawBody: true,
    logger: ["log", "warn", "error"],
  });
  configureApp(app);

  const config = app.get(ConfigService);
  const port = config.get<number>("API_PORT", 4000);
  await app.listen(port, "0.0.0.0");

  const logger = new Logger("Bootstrap");
  logger.log(`API http://localhost:${port}/api/v1 (docs: /api/docs)`);
}

bootstrap().catch((error) => {
  console.error("API failed to start", error);
  process.exit(1);
});
