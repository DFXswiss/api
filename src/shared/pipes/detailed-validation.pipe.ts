import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';
import { MAX_STRING, REDACT_KEY, maskLogValue } from 'src/shared/middlewares/api-trace.middleware';

// Fields listed per rejection, and the cap per rendered value. Both are small on purpose: this is
// a diagnostic hint for the log line, not a body dump.
const MAX_FIELDS = 5;
const MAX_VALUE_LENGTH = 64;
const MAX_DEPTH = 3;

// class-validator constraints whose accepted values are a closed set of literals declared on the
// field. Only these have their rejected value rendered - see `hasLiteralDomain`.
const LITERAL_DOMAIN_CONSTRAINTS = ['isEnum', 'isIn'];

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
 * Renders what was rejected as `field=value` pairs for a log line. Every value here is untrusted
 * input: the content is only rendered for a field that declares its accepted values (see
 * {@link hasLiteralDomain}), a rendered string is then masked by field name (credentials, personal
 * data) and by value pattern (wallet address, email, IP), stripped of control characters and cut
 * to length, and a rendered number or boolean is bounded by being one. Every other field is
 * reduced to its shape, and the list itself is bounded in count and depth.
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
    if (error.constraints) fields.push(`${path}=${renderValue(error.property, error.value, error.constraints)}`);

    if (error.children?.length) {
      if (depth + 1 > MAX_DEPTH) return false;
      if (!collectRejectedValues(error.children, path, depth + 1, fields)) return false;
    }
  }

  return true;
}

function renderValue(property: string, value: unknown, constraints: Record<string, string>): string {
  // Absent is the one thing worth naming for every field: there is nothing to disclose, and it is
  // what separates "the client never sent this" from "the client sent the wrong thing".
  if (value === undefined) return '(missing)';
  if (value === null) return '(null)';
  if (value === '') return "''";

  if (REDACT_KEY.test(property)) return '***';
  if (!hasLiteralDomain(constraints)) return summarize(value);

  if (typeof value === 'string') {
    return value.length > MAX_STRING ? summarize(value) : `'${maskLogValue(value, MAX_VALUE_LENGTH)}'`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return `${value}`;

  return summarize(value);
}

// The value itself is only rendered where the field accepts a closed set of literals. That is the
// case a log line cannot be read without - one client sending one wrong constant looks exactly
// like one sending a different one - and which fields are eligible for it follows from what they
// declare, not from what happened to arrive. A string rendered that way is still untrusted input
// and stays masked and capped; a number or a boolean is already bounded by being one.
//
// Every other field keeps its shape and loses its content: a name-based denylist would have to
// grow with every DTO that ever carries a credential, and the field it has not heard of yet is
// the one that leaks.
function hasLiteralDomain(constraints: Record<string, string>): boolean {
  return Object.keys(constraints).some((constraint) => LITERAL_DOMAIN_CONSTRAINTS.includes(constraint));
}

function summarize(value: unknown): string {
  if (typeof value === 'string') return `<string(${value.length})>`;
  if (Array.isArray(value)) return `<array(${value.length})>`;

  return `<${typeof value}>`;
}
