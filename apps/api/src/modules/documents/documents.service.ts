import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { TenantPrismaService } from "../../common/prisma/tenant-prisma.service";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../../common/auth/auth.types";
import { StorageService } from "./storage.service";
import { CreateUploadDto } from "./dto/document.dto";

@Injectable()
export class DocumentsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, contractId?: string) {
    return this.tenantPrisma.withTenant(tenantId, async (tx) => ({
      items: await tx.document.findMany({
        where: contractId ? { contractId } : {},
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          contractId: true,
          fileName: true,
          contentType: true,
          sizeBytes: true,
          status: true,
          createdAt: true,
          uploadedBy: { select: { fullName: true } },
        },
      }),
    }));
  }

  async createUpload(
    actor: AuthenticatedUser,
    dto: CreateUploadDto,
    ip: string | null,
  ) {
    const safeName = dto.fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120);
    const key = `tenants/${actor.tenantId}/documents/${randomUUID()}-${safeName}`;

    return this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      if (dto.contractId) {
        const contract = await tx.contract.findFirst({
          where: { id: dto.contractId },
          select: { id: true },
        });
        if (!contract) throw new BadRequestException("Shartnoma topilmadi");
      }

      const uploadUrl = await this.storage.presignUpload(key, dto.contentType);
      const document = await tx.document.create({
        data: {
          tenantId: actor.tenantId,
          contractId: dto.contractId ?? null,
          uploadedById: actor.userId,
          key,
          fileName: dto.fileName,
          contentType: dto.contentType,
          sizeBytes: dto.sizeBytes,
          status: "PENDING",
        },
      });
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "document.upload_started",
        entityType: "Document",
        entityId: document.id,
        metadata: { fileName: dto.fileName, contentType: dto.contentType, sizeBytes: dto.sizeBytes },
        ip,
      });
      return {
        documentId: document.id,
        uploadUrl,
        expiresIn: 300,
        requiredHeaders: { "Content-Type": dto.contentType },
      };
    });
  }

  async confirm(
    actor: AuthenticatedUser,
    id: string,
    ip: string | null,
  ) {
    return this.tenantPrisma.withTenant(actor.tenantId, async (tx) => {
      const document = await tx.document.findFirst({ where: { id } });
      if (!document) throw new NotFoundException("Hujjat topilmadi");
      if (document.status === "UPLOADED") {
        return { document, idempotentReplay: true };
      }

      let head: { contentLength: number; contentType: string };
      try {
        head = await this.storage.head(document.key);
      } catch {
        throw new BadRequestException("Fayl saqlashda topilmadi");
      }
      if (head.contentLength !== document.sizeBytes) {
        throw new BadRequestException("Fayl hajmi e'lon qilingan hajmga mos emas");
      }

      const updated = await tx.document.update({
        where: { id },
        data: { status: "UPLOADED" },
      });
      await this.audit.record(tx, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action: "document.uploaded",
        entityType: "Document",
        entityId: id,
        metadata: { fileName: document.fileName, sizeBytes: document.sizeBytes },
        ip,
      });
      return { document: updated, idempotentReplay: false };
    });
  }

  async downloadUrl(actor: AuthenticatedUser, id: string) {
    const document = await this.tenantPrisma.withTenant(actor.tenantId, (tx) =>
      tx.document.findFirst({ where: { id, status: "UPLOADED" } }),
    );
    if (!document) throw new NotFoundException("Hujjat topilmadi");
    const url = await this.storage.presignDownload(document.key, document.fileName);
    return { url, expiresIn: 300 };
  }
}
