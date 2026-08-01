import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import {
  MAX_MASKED_PATTERN,
  capCharacters,
  maskUrl,
  maskValue,
  singleLine,
} from 'src/shared/middlewares/api-trace.middleware';
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

  // How much of the message is looked at before it is masked. An exception message can be as large
  // as the body it interpolated a value from, and masking is regex work over what it is given, so
  // it is not given the whole of it. Two pattern lengths of margin: one for a pattern that starts
  // inside what is kept, one for the tail that is dropped again in `scannable`.
  private static readonly REASON_SCAN_LENGTH = ApiExceptionFilter.REASON_MAX_LENGTH + 2 * MAX_MASKED_PATTERN;

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
      // reason included: an exception message interpolates values, and some of those come from the
      // request.
      const scanned = ApiExceptionFilter.scannable(this.getReason(exception));
      const reason = capCharacters(maskValue(singleLine(scanned)), ApiExceptionFilter.REASON_MAX_LENGTH);
      const rejected =
        exception instanceof ValidationFailedException
          ? ` (received: ${describeRejectedValues(exception.validationErrors)})`
          : '';
      this.logger.warn(`${status} on ${target} from ${describeCaller(request)}: ${reason}${rejected}`);
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

  /**
   * The part of the message that is masked. Masking only shortens what it matches, so what is
   * dropped here cannot come back into view - except at the cut itself: a pattern that straddles it
   * arrives halved, is no longer recognized, and its head would then be one of the characters that
   * survive to the log - masking what precedes it shortens the text, so a position well past the
   * visible cap can end up inside it.
   *
   * So a pattern length is read and then dropped again: what is kept can only hold patterns that
   * ended before the cut, and those were seen whole.
   */
  private static scannable(reason: string): string {
    const scanned = capCharacters(reason, ApiExceptionFilter.REASON_SCAN_LENGTH);
    if (scanned === reason) return reason;

    return capCharacters(scanned, ApiExceptionFilter.REASON_SCAN_LENGTH - MAX_MASKED_PATTERN);
  }

  // Human-readable rejection reason. For HttpExceptions the useful text is in the
  // response body (a plain message, or the class-validator error array), which is
  // more specific than the generic exception.message.
  //
  // The body is whatever the thrower put there, so reading it can throw: an array element that
  // cannot be turned into a string takes `join` with it. That must not cost the response, which is
  // sent after this - the line loses its reason instead.
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
