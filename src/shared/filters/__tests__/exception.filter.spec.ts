import { ArgumentsHost, BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ApiExceptionFilter } from 'src/shared/filters/exception.filter';

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

  it('logs a 4xx at WARN with method, route, status and the rejection reason', () => {
    const response = { status };
    filter.catch(
      new BadRequestException("Support ticket source could not be resolved: missing or unknown 'x-client' header"),
      host(req(), response),
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

  it('masks the route and strips the query string in the log', () => {
    filter.catch(
      new NotFoundException('nope'),
      host(req({ originalUrl: '/v1/user/me?token=supersecret' }), { status }),
    );

    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain('/v1/user/me');
    expect(msg).not.toContain('supersecret');
    expect(msg).not.toContain('token');
  });

  it('logs a 5xx at ERROR (with the exception) and not at WARN', () => {
    const exception = new InternalServerErrorException('boom');
    filter.catch(exception, host(req(), { status }));

    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(500);
  });

  it('treats a non-HttpException as a 500 and returns a generic body', () => {
    filter.catch(new Error('unexpected'), host(req(), { status }));

    expect(error).toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ statusCode: 500, message: 'unexpected' });
  });
});
