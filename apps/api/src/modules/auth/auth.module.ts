import { Module } from "@nestjs/common";
import { CryptoModule } from "../../common/crypto/crypto.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { EmailService } from "./email.service";

@Module({
  imports: [CryptoModule],
  controllers: [AuthController],
  providers: [AuthService, EmailService],
  exports: [AuthService, EmailService],
})
export class AuthModule {}
