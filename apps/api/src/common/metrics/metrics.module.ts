import {
  CallHandler,
  Controller,
  ExecutionContext,
  Get,
  Global,
  Injectable,
  Module,
  NestInterceptor,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";
import { Observable, tap } from "rxjs";
import { Public } from "../auth/decorators";

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpRequests: Counter<string>;
  readonly httpDuration: Histogram<string>;
  readonly notificationDispatches: Counter<string>;
  readonly providerOperations: Counter<string>;

  constructor(private readonly config: ConfigService) {
    if (config.get<boolean>("METRICS_ENABLED", true)) {
      collectDefaultMetrics({ register: this.registry, prefix: "uyushma_" });
    }
    this.registry.setDefaultLabels({ service: "uyushma-api" });
    this.httpRequests = new Counter({
      name: "http_requests_total",
      help: "HTTP so'rovlar soni",
      labelNames: ["method", "route", "status"],
      registers: [this.registry],
    });
    this.httpDuration = new Histogram({
      name: "http_request_duration_seconds",
      help: "HTTP so'rov davomiyligi",
      labelNames: ["method", "route", "status"],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });
    this.notificationDispatches = new Counter({
      name: "notification_dispatches_total",
      help: "Telegram bildirishnomalari",
      labelNames: ["event", "status"],
      registers: [this.registry],
    });
    this.providerOperations = new Counter({
      name: "payment_provider_operations_total",
      help: "To'lov provayderi operatsiyalari",
      labelNames: ["provider", "operation", "status"],
      registers: [this.registry],
    });
  }
}

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const start = process.hrtime.bigint();

    const record = () => {
      const route = request.route?.path ?? request.path ?? "unknown";
      const labels = {
        method: request.method,
        route,
        status: String(response.statusCode),
      };
      this.metrics.httpRequests.inc(labels);
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.metrics.httpDuration.observe(labels, seconds);
    };

    return next.handle().pipe(tap({ next: record, error: record }));
  }
}

@Controller()
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get("metrics")
  async scrape(
    @Req() request: Request,
    @Res() response: Response,
    @Query("token") queryToken: string | undefined,
  ) {
    const expected = this.config.get<string>("METRICS_TOKEN");
    if (expected) {
      const header = request.headers.authorization;
      const bearer = Array.isArray(header) ? header[0] : header;
      const provided = bearer?.startsWith("Bearer ")
        ? bearer.slice(7)
        : queryToken;
      if (provided !== expected) {
        throw new UnauthorizedException("Metrics token yaroqsiz");
      }
    }
    response.setHeader("Content-Type", this.metrics.registry.contentType);
    response.send(await this.metrics.registry.metrics());
  }
}

@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
