import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";
import type { RequestWithUser } from "./auth.types";

function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

abstract class HeaderKeyGuard implements CanActivate {
  protected abstract headerName: string;
  protected abstract configKey: string;

  constructor(protected readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const raw = request.headers[this.headerName.toLowerCase()];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    const expected = this.config.getOrThrow<string>(this.configKey);
    if (!provided || !safeEqual(provided, expected)) {
      throw new UnauthorizedException("Xizmat kaliti noto'g'ri");
    }
    return true;
  }
}

@Injectable()
export class InternalApiGuard extends HeaderKeyGuard {
  protected headerName = "x-internal-api-key";
  protected configKey = "INTERNAL_API_KEY";

  constructor(config: ConfigService) {
    super(config);
  }
}

@Injectable()
export class BotApiGuard extends HeaderKeyGuard {
  protected headerName = "x-bot-api-key";
  protected configKey = "BOT_API_KEY";

  constructor(config: ConfigService) {
    super(config);
  }
}
