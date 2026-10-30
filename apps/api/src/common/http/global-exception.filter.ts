import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  requestId: string;
  code?: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = request.requestId ?? "unknown";

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = "Ichki server xatosi";
    let code: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === "string") {
        message = payload;
      } else if (payload && typeof payload === "object") {
        const body = payload as { message?: string | string[]; error?: string };
        message = body.message ?? exception.message;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === "P2002") {
        status = HttpStatus.CONFLICT;
        message = "Bu ma'lumot allaqachon mavjud";
        code = "DUPLICATE";
      } else if (exception.code === "P2003") {
        status = HttpStatus.CONFLICT;
        message = "Bog'langan yozuv topilmadi yoki xavfsiz o'chirilmaydi";
        code = "FOREIGN_KEY";
      } else if (exception.code === "P2025") {
        status = HttpStatus.NOT_FOUND;
        message = "Yozuv topilmadi";
        code = "NOT_FOUND";
      } else {
        this.logger.error(
          `Prisma ${exception.code} request=${requestId} path=${request.url}`,
        );
      }
    } else {
      this.logger.error(
        `Unhandled request=${requestId} path=${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const errorName =
      status === HttpStatus.BAD_REQUEST
        ? "Bad Request"
        : status === HttpStatus.UNAUTHORIZED
          ? "Unauthorized"
          : status === HttpStatus.FORBIDDEN
            ? "Forbidden"
            : status === HttpStatus.NOT_FOUND
              ? "Not Found"
              : status === HttpStatus.CONFLICT
                ? "Conflict"
                : status === HttpStatus.UNPROCESSABLE_ENTITY
                  ? "Unprocessable Entity"
                  : status === HttpStatus.TOO_MANY_REQUESTS
                    ? "Too Many Requests"
                    : status === HttpStatus.SERVICE_UNAVAILABLE
                      ? "Service Unavailable"
                      : "Internal Server Error";

    const body: ErrorBody = {
      statusCode: status,
      error: errorName,
      message,
      requestId,
      ...(code ? { code } : {}),
    };

    response.status(status).json(body);
  }
}
