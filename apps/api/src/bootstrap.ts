import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { requestIdMiddleware } from "./common/http/request-id.middleware";
import { GlobalExceptionFilter } from "./common/http/global-exception.filter";

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  const origin = config.getOrThrow<string>("APP_ORIGIN");

  app.setGlobalPrefix("api/v1");
  if (config.get<boolean>("TRUST_PROXY", false)) {
    // Only enable behind a trusted reverse proxy that overwrites
    // X-Forwarded-For; otherwise clients can spoof audit/rate-limit IPs.
    app.getHttpAdapter().getInstance().set("trust proxy", 1);
  }
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "same-site" },
      contentSecurityPolicy: false, // API returns JSON; Swagger UI needs relaxed CSP.
    }),
  );
  app.use(requestIdMiddleware);
  app.enableCors({
    origin: origin.split(",").map((value) => value.trim()),
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "Idempotency-Key",
      "X-Internal-Api-Key",
      "X-Bot-Api-Key",
      "X-Request-Id",
      "X-Webhook-Signature",
      "X-Webhook-Timestamp",
    ],
    credentials: false,
    maxAge: 600,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.enableShutdownHooks();

  const swaggerEnabled = config.get<boolean>("ENABLE_SWAGGER", true);
  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("Uyushmachilar API")
      .setDescription(
        "Ko'p kompaniyali transport, shartnoma, tarif va moliya API. " +
          "Har bir tenant ma'lumoti tenantId va PostgreSQL RLS bilan ajratiladi.",
      )
      .setVersion("0.1.0")
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup("api/docs", app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }
}
