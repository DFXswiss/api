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
import { MAX_MASKED_PATTERN } from 'src/shared/middlewares/api-trace.middleware';
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

  it('masks only the front of a request-sized reason, and does so quickly', () => {
    // Masking is regex work over what it is given; the cap throws the rest away anyway.
    const message = `${'a'.repeat(480)}someone@example.com${'b'.repeat(5_000_000)}`;

    const started = process.hrtime.bigint();
    filter.catch(new BadRequestException(message), host(req(), { status }));
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    const msg = warn.mock.calls[0][0] as string;
    expect(msg).not.toContain('someone@example.com');
    expect(msg).toContain('***');
    // Masking this whole message takes seconds; the bound is what is being shown, so the limit is
    // loose enough to survive a loaded machine and still far below what it would cost unbounded.
    expect(elapsedMs).toBeLessThan(1000);
  });

  it('does not let the point where masking stopped expose a pattern it split', () => {
    // Masking only shortens, so text from far past the cap moves into view: three long addresses
    // collapse to nine characters. A pattern the masking never saw whole would be what moves with
    // them - unless a pattern length is dropped from the end of what was masked.
    const scanLength = 500 + 2 * MAX_MASKED_PATTERN;
    const shrinking = Array.from({ length: 3 }, () => `a@${'d'.repeat(240)}.com`).join(' ');
    const secret = 'ZZTOPSECRET@example.com';
    const filler = 'f'.repeat(scanLength - 8 - shrinking.length - 1);
    filter.catch(new BadRequestException(`${shrinking} ${filler}${secret}`), host(req(), { status }));

    const msg = warn.mock.calls[0][0] as string;
    expect(msg).not.toContain('ZZTOPSEC');
    expect(msg).toContain('***');
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
    // Removing the control character rather than replacing it puts the pattern back together, so
    // the masking that runs after it sees the value as the one it is.
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
    // the exception's own message stays where it was: it is what it says to us, not to the caller
    expect(json).toHaveBeenCalledWith({ statusCode: 400, message: 'BAD_REQUEST' });
  });

  it('takes nothing out of a body it could not pass on, the message included', () => {
    // What such a body holds is not what it would have sent, so reading any of it reads something
    // else - and the exception's own message is what it says to us, not to the caller.
    const divergent = new HttpException({ statusCode: 418, message: 'public' }, 400);
    divergent.message = 'INTERNAL_SECRET';

    filter.catch(divergent, host(req(), { status }));

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ statusCode: 400, message: 'BAD_REQUEST' });
  });

  it('names the status when a plain error says nothing about itself', () => {
    filter.catch(new Error(), host(req(), { status }));

    expect(json).toHaveBeenCalledWith({ statusCode: 500, message: 'INTERNAL_SERVER_ERROR' });
  });

  it('names the status when a plain error answers with something that is not text', () => {
    const odd = new Error('x');
    Object.defineProperty(odd, 'message', { value: 42 });

    filter.catch(odd, host(req(), { status }));

    expect(json).toHaveBeenCalledWith({ statusCode: 500, message: 'INTERNAL_SERVER_ERROR' });
  });

  it('sends the response even when a plain error cannot be asked what it says', () => {
    const mute = new Error('x');
    Object.defineProperty(mute, 'message', {
      get: () => {
        throw new Error('nope');
      },
    });

    expect(() => filter.catch(mute, host(req(), { status }))).not.toThrow();
    expect(json).toHaveBeenCalledWith({ statusCode: 500, message: 'INTERNAL_SERVER_ERROR' });
  });

  it('passes on a body that serializes itself, as it would have been without any of this', () => {
    // What such a body holds says nothing about what it sends, so there is nothing to judge and
    // nothing to take out of it.
    const rewriting = new HttpException({ statusCode: 418, message: 'INTERNAL_SECRET' }, 400);
    const body = rewriting.getResponse();
    Object.defineProperty(body, 'toJSON', { value: () => ({ statusCode: 400, message: 'public' }) });

    filter.catch(rewriting, host(req(), { status }));

    expect(json).toHaveBeenCalledWith(body);
  });

  it('takes no message the body would not have sent itself', () => {
    // A property that is not enumerable is left out when the response is serialized, so reading it
    // here would put something on the wire that would never have been on it.
    const hidden = new HttpException({ statusCode: 418 }, 400);
    Object.defineProperty(hidden.getResponse(), 'message', { value: 'INTERNAL_HIDDEN', enumerable: false });

    filter.catch(hidden, host(req(), { status }));

    expect(json).toHaveBeenCalledWith({ statusCode: 400, message: 'BAD_REQUEST' });
  });

  it('rejects a message the body only answers with when asked', () => {
    const accessor = new HttpException({ statusCode: 418 }, 400);
    Object.defineProperty(accessor.getResponse(), 'message', { get: () => 'answered again' });

    filter.catch(accessor, host(req(), { status }));

    expect(json).toHaveBeenCalledWith({ statusCode: 400, message: 'BAD_REQUEST' });
  });

  it('names a status that has no name, rather than leaving the message out', () => {
    const unnamed = new HttpException('x', 599);
    jest.spyOn(unnamed, 'getResponse').mockImplementation(() => {
      throw new Error('nope');
    });
    Object.defineProperty(unnamed, 'message', {
      get: () => {
        throw new Error('nope');
      },
    });

    filter.catch(unnamed, host(req(), { status }));

    expect(json).toHaveBeenCalledWith({ statusCode: 599, message: 'Error' });
  });

  it('reads the status once, so a body cannot arrive under a status it does not name', () => {
    const shifting = new BadRequestException('x');
    let call = 0;
    const getStatus = jest.spyOn(shifting, 'getStatus').mockImplementation(() => (call++ === 0 ? 600 : 400));

    filter.catch(shifting, host(req(), { status }));

    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ statusCode: 500, message: 'INTERNAL_SERVER_ERROR' });
  });

  it('does not take a status it can only be told when it asks as agreement', () => {
    // An accessor is serialized, so the body does carry a status - and it answers again when it is
    // serialized, so what it would carry cannot be read here. The body cannot be passed on.
    const accessor = new BadRequestException('x');
    Object.defineProperty(accessor.getResponse(), 'statusCode', { get: () => 418, enumerable: true });

    filter.catch(accessor, host(req(), { status }));

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ statusCode: 400, message: 'BAD_REQUEST' });
  });

  it('never reads a body whose status had to be replaced', () => {
    const replaced = new HttpException({ statusCode: 418, message: 'INTERNAL_SECRET' }, 600);
    const getResponse = jest.spyOn(replaced, 'getResponse');

    filter.catch(replaced, host(req(), { status }));

    expect(getResponse).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith({ statusCode: 500, message: 'INTERNAL_SERVER_ERROR' });
  });

  it('keeps a failure to report a failed send away from the caller as well', () => {
    const response = {
      status: () => {
        throw new Error('transport down');
      },
    };
    error.mockImplementation(() => {
      throw new Error('logger down');
    });

    expect(() => filter.catch(new BadRequestException('bad'), host(req(), response))).not.toThrow();
  });

  it('drops a body that names a status other than the one being sent', () => {
    filter.catch(new HttpException({ statusCode: 418, message: 'teapot' }, 400), host(req(), { status }));

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ statusCode: 400, message: 'BAD_REQUEST' });
  });

  it('keeps a body that names no status of its own', () => {
    filter.catch(new HttpException({ message: 'plain' }, 400), host(req(), { status }));

    expect(json).toHaveBeenCalledWith({ message: 'plain' });
  });

  it('keeps the diagnostic text when nothing had to be cut away', () => {
    // The tail only has to go where the masking could have split a pattern and the shortening could
    // bring its head into view; a short reason loses nothing.
    filter.catch(new BadRequestException('amount must be a positive number'), host(req(), { status }));

    expect(warn.mock.calls[0][0]).toContain('amount must be a positive number');
  });

  it('keeps a name put on an array body out of the status it is judged by', () => {
    // An array is sent as its elements; a name alongside them is not sent at all, so it names no
    // status to contradict the one being sent.
    const listed = new HttpException(['a', 'b'], 400);
    (listed.getResponse() as unknown as { statusCode: number }).statusCode = 418;

    filter.catch(listed, host(req(), { status }));

    expect(json).toHaveBeenCalledWith(listed.getResponse());
  });

  it('judges a body whose toJSON is only there when asked for like any other', () => {
    // An accessor might answer with a function and might not; the serialization would then send
    // what the body holds, under a status the body does not name.
    const shifting = new HttpException({ statusCode: 418, message: 'INTERNAL_SECRET' }, 400);
    Object.defineProperty(shifting.getResponse(), 'toJSON', { get: () => 42 });

    filter.catch(shifting, host(req(), { status }));

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ statusCode: 400, message: 'BAD_REQUEST' });
  });

  it('passes on a body whose status is a value the serialization leaves out', () => {
    for (const carried of [undefined, () => 418, Symbol('418')]) {
      json.mockClear();
      const omitted = new BadRequestException('x');
      Object.defineProperty(omitted.getResponse(), 'statusCode', { value: carried, enumerable: true });

      filter.catch(omitted, host(req(), { status }));

      expect(json).toHaveBeenCalledWith(omitted.getResponse());
    }
  });

  it('sends the response even when asking what the exception is throws', () => {
    const hostile = new Proxy(new BadRequestException('x'), {
      getPrototypeOf: () => {
        throw new Error('nope');
      },
    });

    expect(() => filter.catch(hostile, host(req(), { status }))).not.toThrow();
    expect(json).toHaveBeenCalledWith({ statusCode: 500, message: 'INTERNAL_SERVER_ERROR' });
  });

  it('sends a server error when the status cannot be read or is not one Express sends', () => {
    const broken = new BadRequestException('x');
    jest.spyOn(broken, 'getStatus').mockImplementation(() => {
      throw new Error('nope');
    });
    filter.catch(broken, host(req(), { status }));
    expect(status).toHaveBeenCalledWith(500);

    for (const invalid of [0, -1, NaN, 100, 199, 600, 1.5]) {
      const outOfRange = new BadRequestException('x');
      jest.spyOn(outOfRange, 'getStatus').mockReturnValue(invalid);
      filter.catch(outOfRange, host(req(), { status }));
      expect(status).toHaveBeenLastCalledWith(500);
    }
  });

  it('sends the response even when the request cannot be read', () => {
    const brokenHost = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => {
          throw new Error('nope');
        },
      }),
    } as unknown as ArgumentsHost;

    expect(() => filter.catch(new BadRequestException('bad'), brokenHost)).not.toThrow();
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
