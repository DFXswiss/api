import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';
import { loggableRejectedValues } from 'src/shared/decorators/log-rejected-value.decorator';
import { REDACT_KEY, maskLogValue } from 'src/shared/middlewares/api-trace.middleware';

// Fields listed per rejection, and the cap per rendered value. Both are small on purpose: this is
// a diagnostic hint for the log line, not a body dump.
const MAX_FIELDS = 5;
const MAX_VALUE_LENGTH = 64;
const MAX_DEPTH = 3;

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
    response: Record<string, unknown>,
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
  createExceptionFactory(): (errors?: ValidationError[]) => unknown {
    const createException = super.createExceptionFactory();

    return (errors: ValidationError[] = []) => {
      const exception = createException(errors);

      // Anything but the 400 is passed through: with `errorHttpStatusCode` set, the base factory
      // builds a different exception class.
      if (!(exception instanceof BadRequestException)) return exception;

      // The base factory composes an object body, and `HttpException.createBody` passes an object
      // through verbatim — that is what keeps the re-raised exception identical. Pinned by the
      // specs that compare the response against a stock `ValidationPipe` for the same body, which
      // is where a change to that would surface.
      return new ValidationFailedException(exception.getResponse() as Record<string, unknown>, errors);
    };
  }
}

/**
 * Renders what was rejected as `field=value` pairs for a log line. What arrived is untrusted input
 * and never reaches the line: a value is rendered only where the field declared the set it may come
 * from, and what is written is that declared constant. Every other field is reduced to its shape,
 * the field name is masked and rendered single-line like any other value from the request, and the
 * list itself is bounded in count and depth.
 */
export function describeRejectedValues(errors: ValidationError[]): string {
  const fields: string[] = [];
  const complete = collectRejectedValues(errors, '', 0, fields);

  return (complete ? fields : [...fields, '…']).join(', ');
}

// Returns false if the walk was cut short (field cap or depth cap), so the caller can mark the
// rendering as incomplete rather than implying the list is everything that was rejected.
function collectRejectedValues(errors: ValidationError[], prefix: string, depth: number, fields: string[]): boolean {
  for (const error of errors) {
    if (fields.length >= MAX_FIELDS) return false;

    // The field name also goes through `maskLogValue`, like a rendered string value does: it is a
    // property of the parsed body, so a DTO that validates through a client-keyed object would put
    // the client in charge of it, and this covers that too.
    const property = maskLogValue(`${error.property}`, MAX_VALUE_LENGTH);
    const path = prefix ? `${prefix}.${property}` : property;
    if (error.constraints) fields.push(`${path}=${renderValue(error)}`);

    if (error.children?.length) {
      if (depth + 1 > MAX_DEPTH) return false;
      if (!collectRejectedValues(error.children, path, depth + 1, fields)) return false;
    }
  }

  return true;
}

function renderValue(error: ValidationError): string {
  const { property, value } = error;

  // Absent is the one thing worth naming for every field: there is nothing to disclose, and it is
  // what separates "the client never sent this" from "the client sent the wrong thing".
  if (value === undefined) return '(missing)';
  if (value === null) return '(null)';
  if (value === '') return "''";

  if (REDACT_KEY.test(property)) return '***';

  const rendered = renderDeclared(error);
  return rendered ?? summarize(value);
}

// A value is rendered only if the field declared it (see {@link LogRejectedValue}) - and what is
// written is the declared constant, not the string that arrived, so nothing the request composed
// reaches the line even where the two differ in case. Every other value keeps its shape and loses
// its content, which is what bounds this: what a validator accepts says nothing about what a client
// sends, and a rejected value is by definition outside what was accepted.
//
// The declaration is read from the object being validated rather than passed down, so a nested DTO
// answers for its own fields. A `ValidationError` built without a target declares nothing.
function renderDeclared(error: ValidationError): string | undefined {
  if (typeof error.value !== 'string' && typeof error.value !== 'number' && typeof error.value !== 'boolean') {
    return undefined;
  }

  const declared = loggableRejectedValues(error.target?.constructor, error.property);
  const match = declared?.get(`${error.value}`.toLowerCase());

  // The constant comes from this code rather than from the request, but it is rendered like every
  // other value on the line - a declaration is written by hand, and nothing here has to trust that.
  return match === undefined ? undefined : `'${maskLogValue(match, MAX_VALUE_LENGTH)}'`;
}

function summarize(value: unknown): string {
  if (typeof value === 'string') return `<string(${value.length})>`;
  if (Array.isArray(value)) return `<array(${value.length})>`;

  return `<${typeof value}>`;
}
