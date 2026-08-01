import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { LogRejectedValue } from 'src/shared/decorators/log-rejected-value.decorator';
import { ApiExceptionFilter } from 'src/shared/filters/exception.filter';
import { ValidationFailedException } from 'src/shared/pipes/detailed-validation.pipe';

describe('ApiExceptionFilter', () => {
  let filter: ApiExceptionFilter;
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  let json: jest.Mock;
  let status: jest.Mock;

  const host = (request: unknown, response: unknown): ArgumentsHost =>
    ({ switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) }) as unknown as ArgumentsHost;

  const req = (overrides: Record<string, unknown> = {}) => ({
    method: 'POST',
    originalUrl: '/v1/support/issue',
    ...overrides,
  });

  beforeEach(() => {
    filter = new ApiExceptionFilter();
    // logger is private; silence + observe it
    warn = jest.spyOn((filter as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation();
    error = jest.spyOn((filter as unknown as { logger: { error: () => void } }).logger, 'error').mockImplementation();
    json = jest.fn();
    status = jest.fn(() => ({ json }));
  });

  it('logs a 400 at WARN with method, route, status and the rejection reason', () => {
    filter.catch(
      new BadRequestException("Support ticket source could not be resolved: missing or unknown 'x-client' header"),
      host(req(), { status }),
    );

    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain('400');
    expect(msg).toContain('POST');
    expect(msg).toContain('/v1/support/issue');
    expect(msg).toContain("missing or unknown 'x-client' header");
    // response is still sent
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalled();
  });

  it('flattens a class-validator message array into the reason', () => {
    filter.catch(
      new BadRequestException({
        statusCode: 400,
        message: ['amount must be positive', 'asset must be a string'],
        error: 'Bad Request',
      }),
      host(req(), { status }),
    );

    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain('amount must be positive; asset must be a string');
  });

  it('also logs 422 (Unprocessable Entity) at WARN', () => {
    filter.catch(new HttpException('bad entity', HttpStatus.UNPROCESSABLE_ENTITY), host(req(), { status }));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('422');
  });

  it('masks the route and strips the query string in the log', () => {
    filter.catch(
      new BadRequestException('bad'),
      host(req({ originalUrl: '/v1/user/me?token=supersecret' }), { status }),
    );

    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain('/v1/user/me');
    expect(msg).not.toContain('supersecret');
    expect(msg).not.toContain('token');
  });

  it('masks PII (wallet address, email) in the rejection reason', () => {
    filter.catch(
      new BadRequestException('Invalid address 0x1234567890abcdef1234567890abcdef12345678 for user foo@bar.com'),
      host(req(), { status }),
    );

    const msg = warn.mock.calls[0][0] as string;
    expect(msg).not.toContain('0x1234567890abcdef1234567890abcdef12345678');
    expect(msg).not.toContain('foo@bar.com');
  });

  it('keeps the reason on one line, so a value interpolated into it cannot forge a second', () => {
    // Exception messages interpolate request values (`Invalid address for ...: ${address}`), so a
    // line break in one of those would otherwise reach the log as a line of its own.
    filter.catch(
      new BadRequestException('Invalid address for to: abc\nWARN [ApiExceptionFilter] forged line'),
      host(req(), { status }),
    );

    const msg = warn.mock.calls[0][0] as string;
    expect(msg).not.toContain('\n');
    expect(msg).toContain('abcWARN');
  });

  it('caps a reason as large as the body it came from, and still masks up to the cap', () => {
    // Exception messages interpolate request values, and a request body is large; the reason is
    // cut to the cap, and a pattern that starts inside it is masked even though it runs past it.
    const message = `${'a'.repeat(480)}someone@example.com${'b'.repeat(200_000)}`;
    filter.catch(new BadRequestException(message), host(req(), { status }));

    const msg = warn.mock.calls[0][0] as string;
    expect(msg).not.toContain('someone@example.com');
    expect(msg).toContain('***');
    expect(msg.length).toBeLessThan(700);
  });

  it('masks a pattern that a control character sits inside', () => {
    // The collapse turns a control character into a space, which would break the pattern apart
    // before it could be recognized - so it runs after the masking, not before it.
    filter.catch(
      new BadRequestException('Invalid recipient victim\u0001@example.com and victim\u0085@example.com'),
      host(req(), { status }),
    );

    const msg = warn.mock.calls[0][0] as string;
    expect(msg).not.toContain('victim');
    expect(msg).not.toContain('example.com');
  });

  it('sends the response even when the body cannot be read', () => {
    const unreadable = new BadRequestException('x');
    jest.spyOn(unreadable, 'getResponse').mockImplementation(() => {
      throw new Error('nope');
    });

    expect(() => filter.catch(unreadable, host(req(), { status }))).not.toThrow();
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ statusCode: 400, message: 'BAD_REQUEST' });
  });

  it('keeps sending the response when the message cannot be read', () => {
    const unreadable = new BadRequestException({
      statusCode: 400,
      message: [
        {
          toString: () => {
            throw new Error('nope');
          },
        },
      ],
    });

    expect(() => filter.catch(unreadable, host(req(), { status }))).not.toThrow();
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalled();
  });

  it('does NOT log routine client errors (401/403/404/429) — they are already in the access log', () => {
    const routine = [
      new UnauthorizedException(),
      new ForbiddenException(),
      new NotFoundException(),
      new HttpException('slow down', HttpStatus.TOO_MANY_REQUESTS),
    ];
    for (const exception of routine) filter.catch(exception, host(req(), { status }));

    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    // but each response is still sent
    expect(status).toHaveBeenCalledTimes(routine.length);
  });

  it('logs a 5xx at ERROR (with the exception) and not at WARN', () => {
    filter.catch(new InternalServerErrorException('boom'), host(req(), { status }));

    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(500);
  });

  it('names the caller, so a rejection on an unauthenticated endpoint is attributable', () => {
    filter.catch(
      new BadRequestException('bad'),
      host(req({ headers: { 'x-client': 'dfx-services', origin: 'https://app.dfx.swiss' } }), { status }),
    );

    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain('client=dfx-services');
    expect(msg).toContain('origin=https://app.dfx.swiss');
  });

  it('marks a caller that identifies itself with nothing', () => {
    filter.catch(new BadRequestException('bad'), host(req({ headers: {} }), { status }));

    expect(warn.mock.calls[0][0]).toContain('client=(none)');
  });

  it('appends the rejected values of a failed validation — the message alone names only the field', () => {
    class PaymentDto {
      @LogRejectedValue(['Bank', 'Instant', 'Card', 'Crypto'])
      paymentMethod: string;
    }

    const error: ValidationError = {
      property: 'paymentMethod',
      value: 'Crypto',
      constraints: { isEnum: 'paymentMethod must be one of the following values: Bank, Instant, Card' },
      children: [],
      target: new PaymentDto(),
    };

    filter.catch(
      new ValidationFailedException({ statusCode: 400, message: [error.constraints.isEnum] }, [error]),
      host(req({ headers: {} }), { status }),
    );

    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain('must be one of the following values');
    expect(msg).toContain("received: paymentMethod='Crypto'");
    // the client still gets exactly the body the validation pipe built
    expect(json).toHaveBeenCalledWith({ statusCode: 400, message: [error.constraints.isEnum] });
  });

  it('treats a non-HttpException as a 500 and returns a generic body', () => {
    filter.catch(new Error('unexpected'), host(req(), { status }));

    expect(error).toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ statusCode: 500, message: 'unexpected' });
  });
});
