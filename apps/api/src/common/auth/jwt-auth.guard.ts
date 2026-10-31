import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { TenantPrismaService } from "../prisma/tenant-prisma.service";
import { IS_PUBLIC_KEY } from "./decorators";
import type { AccessTokenPayload, RequestWithUser } from "./auth.types";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const header = request.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    if (!value?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Avtorizatsiya talab qilinadi");
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(value.slice(7), {
        secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
        issuer: this.config.getOrThrow<string>("JWT_ISSUER"),
        audience: this.config.getOrThrow<string>("JWT_AUDIENCE"),
      });
    } catch {
      throw new UnauthorizedException("Token yaroqsiz yoki muddati tugagan");
    }

    if (payload.typ !== "access" || !payload.sub || !payload.tenantId) {
      throw new UnauthorizedException("Token turi noto'g'ri");
    }

    const user = await this.tenantPrisma.withTenant(payload.tenantId, async (tx) => {
      const found = await tx.user.findFirst({
        where: {
          id: payload.sub,
          isActive: true,
          company: { status: "ACTIVE" },
        },
        select: { id: true, phone: true, fullName: true, role: true, isSuperAdmin: true },
      });
      if (!found) return null;
      if (payload.sessionId) {
        // Revoking a device session must invalidate its access token at once,
        // not only when the short-lived token happens to expire.
        const session = await tx.refreshToken.findFirst({
          where: {
            tenantId: payload.tenantId,
            userId: found.id,
            sessionId: payload.sessionId,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
        });
        if (!session) return null;
      }
      return found;
    });
    if (!user) {
      throw new UnauthorizedException("Foydalanuvchi faol emas");
    }

    request.user = {
      userId: user.id,
      tenantId: payload.tenantId,
      role: user.role,
      phone: user.phone,
      fullName: user.fullName,
      isSuperAdmin: user.isSuperAdmin,
      sessionId: payload.sessionId,
    };
    return true;
  }
}
