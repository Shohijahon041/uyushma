import { ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    // Automated integration tests set this explicitly; never in production.
    if (process.env.THROTTLE_DISABLED === "true" && process.env.NODE_ENV === "test") {
      return true;
    }
    return super.shouldSkip(context);
  }
}
