import { DfxLogger } from 'src/shared/services/dfx-logger';
import { ClientErrorService } from '../client-error.service';
import { CreateClientErrorDto } from '../dto/create-client-error.dto';

describe('ClientErrorService', () => {
  let service: ClientErrorService;
  let error: jest.SpyInstance;

  function dto(values: Partial<CreateClientErrorDto> = {}): CreateClientErrorDto {
    return Object.assign(new CreateClientErrorDto(), { message: 'Loading chunk 42 failed', ...values });
  }

  function loggedLine(): string {
    return error.mock.calls[0][0];
  }

  beforeEach(() => {
    service = new ClientErrorService();
    error = jest.spyOn(DfxLogger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('logs the error at ERROR level', () => {
    service.logError(dto({ type: 'ChunkLoadError' }));

    expect(error).toHaveBeenCalledTimes(1);
    expect(loggedLine()).toContain('Client error: ChunkLoadError: Loading chunk 42 failed');
  });

  it('logs the message alone when no type is given', () => {
    service.logError(dto());

    expect(loggedLine()).toContain('Client error: Loading chunk 42 failed');
  });

  it('logs client, route, version and user agent', () => {
    service.logError(dto({ route: '/buy', version: '1.2.3' }), 'dfx-services', 'Mozilla/5.0');

    expect(loggedLine()).toContain('client=dfx-services');
    expect(loggedLine()).toContain('route=/buy');
    expect(loggedLine()).toContain('version=1.2.3');
    expect(loggedLine()).toContain('userAgent=Mozilla/5.0');
  });

  it('marks absent context as unknown', () => {
    service.logError(dto());

    expect(loggedLine()).toContain('client=unknown');
    expect(loggedLine()).toContain('route=unknown');
    expect(loggedLine()).toContain('version=unknown');
    expect(loggedLine()).toContain('userAgent=unknown');
  });

  it('appends the stack when given', () => {
    service.logError(dto({ stack: 'at BuyScreen (main.js:1:2)' }));

    expect(loggedLine()).toContain('stack=at BuyScreen (main.js:1:2)');
  });

  it('omits the stack marker when no stack is given', () => {
    service.logError(dto());

    expect(loggedLine()).not.toContain('stack=');
  });

  // --- SANITIZING --- //

  it('discards the query string of a route', () => {
    service.logError(dto({ route: '/buy?session=eyJhbGciOi&asset=BTC' }));

    expect(loggedLine()).toContain('route=/buy ');
    expect(loggedLine()).not.toContain('eyJhbGciOi');
    expect(loggedLine()).not.toContain('asset=BTC');
  });

  it('discards the fragment of a route', () => {
    service.logError(dto({ route: '/buy#session=eyJhbGciOi' }));

    expect(loggedLine()).toContain('route=/buy ');
    expect(loggedLine()).not.toContain('eyJhbGciOi');
  });

  it.each(['session', 'signature', 'address', 'mail', 'token', 'key', 'otp', 'code'])(
    'redacts the %s parameter carried inside a message',
    (param) => {
      service.logError(dto({ message: `Failed to load https://app.example.com/buy?${param}=s3cr3t` }));

      expect(loggedLine()).toContain(`${param}=<redacted>`);
      expect(loggedLine()).not.toContain('s3cr3t');
    },
  );

  it('redacts sensitive parameters carried inside a stack', () => {
    service.logError(dto({ stack: 'at load (https://app.example.com/buy?signature=abc123&x=1)' }));

    expect(loggedLine()).toContain('signature=<redacted>');
    expect(loggedLine()).not.toContain('abc123');
  });

  it('keeps the parameters that follow a redacted one', () => {
    service.logError(dto({ message: 'GET /buy?session=s3cr3t&asset=BTC failed' }));

    expect(loggedLine()).toContain('session=<redacted>');
    expect(loggedLine()).toContain('asset=BTC');
    expect(loggedLine()).not.toContain('s3cr3t');
  });

  it('redacts a sensitive parameter regardless of case', () => {
    service.logError(dto({ message: 'GET /buy?Signature=s3cr3t failed' }));

    expect(loggedLine()).toContain('<redacted>');
    expect(loggedLine()).not.toContain('s3cr3t');
  });

  // The endpoint is unauthenticated, so a forged payload must not be able to open a line that
  // reads like a log entry of its own.
  it('collapses line breaks so a payload cannot forge further log lines', () => {
    service.logError(dto({ message: 'real\n[Nest] 7 - ERROR [PayoutService] forged' }));

    expect(loggedLine()).not.toContain('\n');
    expect(loggedLine()).toContain('real | [Nest] 7 - ERROR [PayoutService] forged');
  });

  it('collapses line breaks in a stack', () => {
    service.logError(dto({ stack: 'at a (main.js:1:2)\r\n  at b (main.js:3:4)' }));

    expect(loggedLine()).not.toContain('\n');
    expect(loggedLine()).toContain('at a (main.js:1:2) | at b (main.js:3:4)');
  });

  it('collapses line breaks in the user agent', () => {
    service.logError(dto(), 'dfx-services', 'Mozilla/5.0\nforged');

    expect(loggedLine()).not.toContain('\n');
  });
});
