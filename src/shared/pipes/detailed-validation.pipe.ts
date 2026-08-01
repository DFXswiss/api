import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';
import { REDACT_KEY, maskLogValue } from 'src/shared/middlewares/api-trace.middleware';

// Fields listed per rejection, and the cap per rendered value. Both are small on purpose: this is
// a diagnostic hint for the log line, not a body dump.
const MAX_FIELDS = 5;
const MAX_VALUE_LENGTH = 64;
const MAX_DEPTH = 3;

// Above this the value is summarized by length instead of rendered. Masking is regex work, and a
// 20 MB string in a rejected body must not turn a log line into seconds of synchronous CPU.
const MAX_RENDERED_LENGTH = 512;

/**
 * A failed request-body validation, carrying the raw `ValidationError[]` alongside the response.
 *
 * The response body is the one the stock `ValidationPipe` would have produced — this only keeps the
 * errors reachable for the log line in `ApiExceptionFilter`, which is where the rejected *value*
 * becomes visible. The constraint messages in the body name the field and the accepted values, not
 * the value that arrived, so a wrong constant in a client cannot be named from the logs otherwise.
 */
export class ValidationFailedException extends BadRequestException {
  constructor(
    response: Record<string, any>,
    readonly validationErrors: ValidationError[],
  ) {
    super(response);
  }
}

/**
 * `ValidationPipe` that raises a {@link ValidationFailedException} instead of a plain
 * `BadRequestException`. The response is unchanged: the exception is built by the base factory and
 * only re-wrapped, so status, message array and body shape are byte-identical to the stock pipe.
 */
export class DetailedValidationPipe extends ValidationPipe {
  createExceptionFactory() {
    const createException = super.createExceptionFactory();

    return (errors: ValidationError[] = []) => {
      const exception = createException(errors);

      // Anything but the 400 is passed through: with `errorHttpStatusCode` set, the base factory
      // builds a different exception class.
      if (!(exception instanceof BadRequestException)) return exception;

      // The base factory always composes an object body, and `HttpException.createBody` passes an
      // object through verbatim — that is what keeps the re-raised exception identical. A string
      // response would instead be re-wrapped into a different body, so it is passed through.
      const response = exception.getResponse();
      if (typeof response !== 'object' || response === null) return exception;

      return new ValidationFailedException(response as Record<string, any>, errors);
    };
  }
}

/**
 * Renders the values that were rejected as `field=value` pairs for a log line — bounded in count,
 * depth and length, masked by field name (credentials, personal data) and by value pattern (wallet
 * address, email, IP), and stripped of control characters. Every value here is untrusted input.
 */
export function describeRejectedValues(errors: ValidationError[]): string {
  const fields: string[] = [];
  const complete = collectRejectedValues(errors, '', 0, fields);

  return complete ? fields.join(', ') : `${fields.join(', ')}, …`;
}

// Returns false if the walk was cut short (field cap or depth cap), so the caller can mark the
// rendering as incomplete rather than implying the list is everything that was rejected.
function collectRejectedValues(errors: ValidationError[], prefix: string, depth: number, fields: string[]): boolean {
  for (const error of errors) {
    if (fields.length >= MAX_FIELDS) return false;

    const path = prefix ? `${prefix}.${error.property}` : `${error.property}`;
    if (error.constraints) fields.push(`${path}=${renderValue(error.property, error.value)}`);

    if (error.children?.length) {
      if (depth + 1 > MAX_DEPTH) return false;
      if (!collectRejectedValues(error.children, path, depth + 1, fields)) return false;
    }
  }

  return true;
}

function renderValue(property: string, value: unknown): string {
  if (REDACT_KEY.test(property)) return '***';
  if (value === undefined) return '(missing)';
  if (value === null) return '(null)';

  if (typeof value === 'string') {
    if (value === '') return "''";
    if (value.length > MAX_RENDERED_LENGTH) return `<${value.length} chars>`;
    return `'${maskLogValue(value, MAX_VALUE_LENGTH)}'`;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return `${value}`;
  if (Array.isArray(value)) return `<array(${value.length})>`;

  return `<${typeof value}>`;
}
