import { DfxLogger } from 'src/shared/services/dfx-logger';
import { ClientErrorService } from '../client-error.service';
import { CreateClientErrorDto } from '../dto/create-client-error.dto';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.abc';

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
    expect(loggedLine()).toContain('message="Loading chunk 42 failed"');
    expect(loggedLine()).toContain('type="ChunkLoadError"');
  });

  it('logs client, route, version and user agent', () => {
    service.logError(dto({ route: '/buy', version: '1.2.3' }), 'dfx-services', 'Mozilla/5.0');

    expect(loggedLine()).toContain('client="dfx-services"');
    expect(loggedLine()).toContain('route="/buy"');
    expect(loggedLine()).toContain('version="1.2.3"');
    expect(loggedLine()).toContain('userAgent="Mozilla/5.0"');
  });

  it('logs absent context as an empty value', () => {
    service.logError(dto());

    expect(loggedLine()).toContain('client=""');
    expect(loggedLine()).toContain('route=""');
    expect(loggedLine()).toContain('version=""');
    expect(loggedLine()).toContain('userAgent=""');
  });

  it('appends the stack when given', () => {
    service.logError(dto({ stack: 'at BuyScreen (main.js:1:2)' }));

    expect(loggedLine()).toContain('stack="at BuyScreen (main.js:1:2)"');
  });

  it('omits the stack field when no stack is given', () => {
    service.logError(dto());

    expect(loggedLine()).not.toContain('stack=');
  });

  // --- REDACTING --- //
  // The endpoint is unauthenticated, so every field is attacker-controlled. A URL is cut to its
  // path, which is what makes the encoding of a parameter irrelevant; matching parameter names
  // alone loses a round to every new encoding.

  it.each([
    ['a query string', `GET https://app.example.com/buy?session=${TOKEN}&asset=BTC failed`],
    ['a fragment', `https://app.example.com/cb#session=${TOKEN}`],
    ['a matrix parameter', `https://app.example.com/buy;session=${TOKEN}`],
    ['a percent-encoded parameter', `https://app.example.com/buy?session%3D${TOKEN}`],
    ['a double-encoded parameter', `https://app.example.com/buy?session%253D${TOKEN}`],
    ['a percent-encoded parameter name', `https://app.example.com/buy?sess%69on=${TOKEN}`],
  ])('drops %s from a URL', (_case, message) => {
    service.logError(dto({ message }));

    expect(loggedLine()).not.toContain(TOKEN);
  });

  it.each([
    ['at the start of the value', `session=${TOKEN} lookup failed`],
    ['behind a colon', `session: ${TOKEN}`],
    ['in JSON', `{"token":"${TOKEN}"}`],
    ['in a compound name', `accessToken=${TOKEN}`],
    ['in a quoted value', `session="${TOKEN} more"`],
    ['regardless of case', `Signature=${TOKEN}`],
  ])('masks a bare secret assignment %s', (_case, message) => {
    service.logError(dto({ message }));

    expect(loggedLine()).toContain('<redacted>');
    expect(loggedLine()).not.toContain(TOKEN);
  });

  it.each(['session', 'signature', 'password', 'secret', 'token', 'otp', 'jwt', 'auth', 'mail', 'apikey'])(
    'masks the %s assignment',
    (name) => {
      service.logError(dto({ message: `${name}=${TOKEN}` }));

      expect(loggedLine()).not.toContain(TOKEN);
    },
  );

  it('redacts a credential carried in a stack', () => {
    service.logError(dto({ stack: `at load (https://app.example.com/buy?signature=${TOKEN})` }));

    expect(loggedLine()).not.toContain(TOKEN);
  });

  // The counterpart failure: a name list broad enough to catch everything also redacts the fields
  // that make a report worth reading. These are the ones a frontend error actually carries.
  it.each([
    'statusCode=502',
    'errorCode=E_TIMEOUT',
    'countryCode=CH',
    'currencyCode=CHF',
    'zipCode=8000',
    'keyboardLayout=qwerty',
    'monkey=banana',
    'asset=BTC',
    'amount=300',
    'chunkId=738',
  ])('keeps the diagnostic value %s', (value) => {
    service.logError(dto({ message: `failed with ${value}` }));

    expect(loggedLine()).toContain(value);
  });

  it('keeps the asset path of a failed chunk, which is the point of the report', () => {
    service.logError(dto({ message: 'Loading chunk 738 failed (missing: https://app.example.com/static/js/738.js)' }));

    expect(loggedLine()).toContain('https://app.example.com/static/js/738.js');
  });

  it('discards the query string, fragment and matrix parameters of a route', () => {
    service.logError(dto({ route: `/buy;session=${TOKEN}?asset=BTC#top` }));

    expect(loggedLine()).toContain('route="/buy"');
    expect(loggedLine()).not.toContain(TOKEN);
  });

  // --- LOG INTEGRITY --- //

  it('quotes the free text so it cannot forge a log line', () => {
    service.logError(dto({ message: 'real\n[Nest] 7 - ERROR [PayoutService] forged' }));

    expect(loggedLine()).not.toContain('\n');
    expect(loggedLine()).toContain('message="real\\n[Nest] 7 - ERROR [PayoutService] forged"');
  });

  // Without quoting, this reads as context fields of its own and a log query cannot tell the
  // forged ones from the genuine ones that follow.
  it('quotes the free text so it cannot forge context fields', () => {
    service.logError(dto({ message: 'boom route=/internal client=support trace_id=deadbeef' }));

    expect(loggedLine()).toContain('message="boom route=/internal client=support trace_id=deadbeef"');
    expect(loggedLine()).toContain('route=""');
  });

  it('escapes control characters so a payload cannot repaint a terminal tailing the log', () => {
    service.logError(dto({ stack: '\u001b[2J\u001b[31mFAKE CRITICAL\u001b[0m' }));

    expect(loggedLine()).not.toContain('\u001b');
    expect(loggedLine()).toContain('\\u001b');
  });

  it.each([
    ['line separator', '\u2028'],
    ['paragraph separator', '\u2029'],
    ['next line', '\u0085'],
    ['delete', '\u007f'],
  ])('replaces the %s character, which survives string escaping', (_name, char) => {
    service.logError(dto({ message: `a${char}b` }));

    expect(loggedLine()).toContain('message="a b"');
  });

  it('escapes a quote so it cannot close the field early', () => {
    service.logError(dto({ message: 'boom" route="/internal' }));

    expect(loggedLine()).toContain('\\"');
    expect(loggedLine()).toContain('route=""');
  });

  // --- BUDGET --- //
  // Per-IP throttling bounds one client. Without a ceiling across all of them, a distributed flood
  // would bury genuine incidents in the same ERROR stream that alerting reads.

  it('logs every report while within the budget', () => {
    for (let i = 0; i < 120; i++) service.logError(dto());

    expect(error).toHaveBeenCalledTimes(120);
  });

  it('drops reports beyond the budget instead of flooding the stream', () => {
    for (let i = 0; i < 130; i++) service.logError(dto());

    expect(error).toHaveBeenCalledTimes(120);
  });

  it('reports how many were dropped once the window rolls over', () => {
    jest.useFakeTimers();
    try {
      for (let i = 0; i < 130; i++) service.logError(dto());
      jest.advanceTimersByTime(60001);

      service.logError(dto());

      const lines = error.mock.calls.map((c) => c[0] as string);
      expect(lines).toContain('Client error reporting over budget: 10 reports dropped');
    } finally {
      jest.useRealTimers();
    }
  });

  it('logs again after the window rolls over', () => {
    jest.useFakeTimers();
    try {
      for (let i = 0; i < 130; i++) service.logError(dto());
      error.mockClear();
      jest.advanceTimersByTime(60001);

      service.logError(dto({ message: 'after the window' }));

      expect(error.mock.calls.some((c) => (c[0] as string).includes('after the window'))).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
