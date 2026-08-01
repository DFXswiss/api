import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { capCharacters, maskUrl, maskValue, singleLine } from 'src/shared/middlewares/api-trace.middleware';
import { ValidationFailedException, describeRejectedValues } from 'src/shared/pipes/detailed-validation.pipe';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { describeCaller } from 'src/shared/utils/request-caller';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  // 4xx statuses whose reason is worth a WARN: the client sent a request body the
  // server rejected, which is where a server-side regression hides (#4105 was a
  // 400). The high-volume routine client errors (401/403/404/429) are already in
  // the morgan access log and their reason adds nothing, so they are not
  // re-logged here — that would just flood the logs and bury the signal.
  private static readonly WARN_CLIENT_ERRORS: number[] = [HttpStatus.BAD_REQUEST, HttpStatus.UNPROCESSABLE_ENTITY];

  // Cap the (masked) reason: exception messages can embed user-supplied free text.
  private static readonly REASON_MAX_LENGTH = 500;

  private readonly logger = new DfxLogger(ApiExceptionFilter);

  catch(exception: Error, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = ApiExceptionFilter.statusOf(exception);

    // The response goes out first, and nothing it does not need is read before it. Everything the
    // line renders comes from the request or from the thrower, and reading either can throw - which
    // used to leave the caller with no response at all rather than with a line missing a detail.
    try {
      response.status(status).json(this.responseBody(exception, status));
    } catch (e) {
      this.logger.error(`Failed to set error response content:`, e);
    }

    const request = ctx.getRequest<Request>();
    const target = `${request.method} request to '${maskUrl(request.originalUrl ?? request.url ?? '')}'`;
    if (status >= 500) {
      // log server errors with the full error + stack
      this.logger.error(`Exception during ${target}:`, exception);
    } else if (ApiExceptionFilter.WARN_CLIENT_ERRORS.includes(status)) {
      // log the reason for a rejected request body, so a server-side regression
      // that surfaces as a 4xx (a valid request the server wrongly rejects) is
      // visible in the logs instead of leaving only a bare morgan status line with
      // no reason (the #4105 support-ticket outage was silent for exactly this).
      //
      // The caller markers and the rejected values are what make a steady stream of rejections
      // actionable: the constraint message names the field and the allowed values, so without the
      // value that arrived and a hint at who sent it, a wrong constant in a client can only be
      // guessed at.
      //
      // All three are untrusted input and rendered as such - single-line, masked and capped. The
      // reason included: an exception message can interpolate a value the request supplied.
      const reason = capCharacters(
        maskValue(singleLine(this.getReason(exception))),
        ApiExceptionFilter.REASON_MAX_LENGTH,
      );
      const rejected =
        exception instanceof ValidationFailedException
          ? ` (received: ${describeRejectedValues(exception.validationErrors)})`
          : '';
      this.logger.warn(`${status} on ${target} from ${describeCaller(request)}: ${reason}${rejected}`);
    }
  }

  // The status an HttpException carries is whatever the thrower put there: reading it can throw, and
  // what comes back is not necessarily one Express will send. Anything outside the range it accepts
  // is a server error by the only reading left.
  private static statusOf(exception: Error): number {
    try {
      if (!(exception instanceof HttpException)) return HttpStatus.INTERNAL_SERVER_ERROR;

      const status = exception.getStatus();
      return Number.isInteger(status) && status >= 100 && status <= 599 ? status : HttpStatus.INTERNAL_SERVER_ERROR;
    } catch {
      return HttpStatus.INTERNAL_SERVER_ERROR;
    }
  }

  // The body an HttpException carries is whatever the thrower put there, and reading it can throw.
  // A caller gets the generic body then rather than none.
  private responseBody(exception: Error, status: number): unknown {
    try {
      if (exception instanceof HttpException) return exception.getResponse();
    } catch {
      return { statusCode: status, message: HttpStatus[status] ?? 'Error' };
    }

    return { statusCode: status, message: exception.message };
  }

  // Human-readable rejection reason. For HttpExceptions the useful text is in the
  // response body (a plain message, or the class-validator error array), which is
  // more specific than the generic exception.message.
  //
  // The body is whatever the thrower put there, so reading it can throw: an array element that
  // cannot be turned into a string takes `join` with it. The response has already gone out by then;
  // the line loses its reason instead.
  private getReason(exception: Error): string {
    try {
      if (exception instanceof HttpException) {
        const res = exception.getResponse();
        if (typeof res === 'string') return res;

        const message = (res as { message?: unknown }).message;
        if (Array.isArray(message)) return message.join('; ');
        if (typeof message === 'string') return message;
      }

      return exception.message;
    } catch {
      return '(unreadable reason)';
    }
  }
}
