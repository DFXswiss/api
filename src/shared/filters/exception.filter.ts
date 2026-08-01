import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { MAX_MASKED_PATTERN, capCharacters, maskLogText, maskUrl } from 'src/shared/middlewares/api-trace.middleware';
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

  // How much of the message is masked at all. An exception message can be as large as the body it
  // interpolated a value from, and masking is regex work over what it is given - a request-sized one
  // held the thread for seconds. Two pattern lengths of margin over the cap: one for a pattern that
  // starts inside what stays visible, one for the tail that is dropped again below.
  private static readonly REASON_SCAN_LENGTH = ApiExceptionFilter.REASON_MAX_LENGTH + 2 * MAX_MASKED_PATTERN;

  private readonly logger = new DfxLogger(ApiExceptionFilter);

  catch(exception: Error, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = ApiExceptionFilter.statusOf(exception);

    // The response goes out first, and nothing it does not need is read before it. Everything the
    // line renders comes from the request or from the thrower, and reading either can throw - which
    // used to leave the caller with no response at all rather than with a line missing a detail.
    let failed: Error | undefined;
    try {
      response.status(status.sent).json(this.responseBody(exception, status));
    } catch (e) {
      failed = e as Error;
    }

    // The response is out; what follows only describes it, this failure included. A failure to
    // describe it must not travel back to a caller who already has an answer, so it ends here -
    // including a failure of the logger, which is the one thing that could not report it anyway.
    try {
      if (failed) this.logger.error(`Failed to set error response content:`, failed);
      this.describe(exception, ctx.getRequest<Request>(), status.sent);
    } catch {
      return;
    }
  }

  private describe(exception: Error, request: Request, status: number): void {
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
      const reason = ApiExceptionFilter.reasonOf(this.getReason(exception));
      const rejected =
        exception instanceof ValidationFailedException
          ? ` (received: ${describeRejectedValues(exception.validationErrors)})`
          : '';
      this.logger.warn(`${status} on ${target} from ${describeCaller(request)}: ${reason}${rejected}`);
    }
  }

  /**
   * The masked, single-line, capped part of the message that reaches the line.
   *
   * Only the front of the message is masked, because masking is the expensive part and the cap
   * would throw the rest away anyway. A pattern crossing the point where the masking stopped
   * arrives halved and is not recognized, and its head is then the last thing the masking produced
   * - so a pattern length is dropped from the end of what came back. What is kept can only hold
   * patterns that ended before that point, and those were seen whole. The tail goes after the
   * masking rather than before it: masking only shortens, so a position past the cap can move into
   * view, and dropping the tail first would leave that halved head to move with it.
   */
  private static reasonOf(reason: string): string {
    const scanned = capCharacters(reason, ApiExceptionFilter.REASON_SCAN_LENGTH);
    const masked = maskLogText(scanned);

    return capCharacters(
      ApiExceptionFilter.withoutSplitTail(masked, scanned === reason),
      ApiExceptionFilter.REASON_MAX_LENGTH,
    );
  }

  // Nothing was cut, or what the masking left is long enough that its end stays past the cap either
  // way: the tail costs diagnostic text and buys nothing there.
  private static withoutSplitTail(masked: string, complete: boolean): string {
    const length = [...masked].length;
    if (complete || length > ApiExceptionFilter.REASON_MAX_LENGTH + MAX_MASKED_PATTERN) return masked;

    return capCharacters(masked, Math.max(0, length - MAX_MASKED_PATTERN));
  }

  // The status an HttpException carries is whatever the thrower put there: reading it can throw, and
  // what comes back is not necessarily a final response at all - a 1xx is an interim one, and
  // nothing outside the range it can send leaves a reading other than server error.
  private static statusOf(exception: Error): { sent: number; declared: number | undefined } {
    try {
      if (!(exception instanceof HttpException)) return { sent: HttpStatus.INTERNAL_SERVER_ERROR, declared: undefined };

      const declared = exception.getStatus();
      const usable = Number.isInteger(declared) && declared >= 200 && declared <= 599;

      return { sent: usable ? declared : HttpStatus.INTERNAL_SERVER_ERROR, declared };
    } catch {
      return { sent: HttpStatus.INTERNAL_SERVER_ERROR, declared: undefined };
    }
  }

  // The body an HttpException carries is whatever the thrower put there, and reading it can throw.
  // A caller gets the generic body then rather than none - and also when the status it was going to
  // be sent with is not the one it names, which is what a replaced status leaves behind.
  private responseBody(exception: Error, status: { sent: number; declared: number | undefined }): unknown {
    try {
      // The status is read once, above: reading it again could answer differently, and the body
      // would then be sent alongside a status it does not name. The body says so itself as well -
      // `new HttpException({ statusCode: 418 }, 400)` names two - so it is only kept when both agree.
      if (exception instanceof HttpException && status.declared === status.sent) {
        const body = exception.getResponse();
        if (ApiExceptionFilter.names(body, status.sent)) return body;
      }
    } catch {
      // an exception that cannot say what it is gets described by what is being sent
    }

    return { statusCode: status.sent, message: ApiExceptionFilter.messageOf(exception, status.sent) };
  }

  // A body that carries no status of its own contradicts nothing. One that carries an accessor is
  // read again when it is serialized and can answer differently then, so only a plain value counts.
  private static names(body: unknown, status: number): boolean {
    if (typeof body !== 'object' || body === null) return true;

    const declared = Object.getOwnPropertyDescriptor(body, 'statusCode');
    if (declared && !('value' in declared)) return false;

    return declared === undefined || declared.value === status;
  }

  // Not every status in the range has a name, so the name is a fallback and not the last one.
  private static messageOf(exception: Error, status: number): string {
    try {
      return exception.message || HttpStatus[status] || 'Error';
    } catch {
      return HttpStatus[status] || 'Error';
    }
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
