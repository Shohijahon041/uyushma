import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma/prisma.service";
import { TenantPrismaService } from "./prisma/tenant-prisma.service";

@Global()
@Module({
  providers: [PrismaService, TenantPrismaService],
  exports: [PrismaService, TenantPrismaService],
})
export class DataModule {}
