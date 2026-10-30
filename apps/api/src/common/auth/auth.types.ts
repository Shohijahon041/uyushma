import type { UserRole } from "@prisma/client";

export interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  typ: "access";
  role: UserRole;
  sessionId?: string;
}

export interface RefreshTokenPayload {
  sub: string;
  tenantId: string;
  typ: "refresh";
  sessionId?: string;
  jti: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  role: UserRole;
  email: string;
  fullName: string;
  isSuperAdmin: boolean;
  sessionId?: string;
}

export interface RequestWithUser {
  user?: AuthenticatedUser;
  ip?: string;
  socket?: { remoteAddress?: string };
  headers: Record<string, string | string[] | undefined>;
  rawBody?: Buffer;
}
