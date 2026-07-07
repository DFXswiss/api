import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { maskUrl } from 'src/shared/middlewares/api-trace.middleware';
import { DfxLogger } from '../services/dfx-logger';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new DfxLogger(ApiExceptionFilter);

  catch(exception: Error, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest<Request>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const target = `${request.method} request to '${maskUrl(request.originalUrl ?? request.url ?? '')}'`;
    if (status >= 500) {
      // log server errors with the full error + stack
      this.logger.error(`Exception during ${target}:`, exception);
    } else if (status >= 400) {
      // log the client-error reason, so a server-side regression that surfaces as
      // a 4xx (a valid request the server wrongly rejects) is visible in the logs
      // instead of leaving only a bare morgan status line with no reason (the
      // #4105 support-ticket outage was silent for exactly this reason).
      this.logger.warn(`${status} on ${target}: ${this.getReason(exception)}`);
    }

    try {
      response.status(status).json(
        exception instanceof HttpException
          ? exception.getResponse()
          : {
              statusCode: status,
              message: exception.message,
            },
      );
    } catch (e) {
      this.logger.error(`Failed to set error response content:`, e);
    }
  }

  // Human-readable rejection reason. For HttpExceptions the useful text is in the
  // response body (a plain message, or the class-validator error array), which is
  // more specific than the generic exception.message.
  private getReason(exception: Error): string {
    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === 'string') return res;

      const message = (res as { message?: string | string[] }).message;
      if (Array.isArray(message)) return message.join('; ');
      if (message) return message;
    }

    return exception.message;
  }
}
