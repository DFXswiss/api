import { SpawnSyncReturns } from 'child_process';
import { Request } from 'express';
import { join } from 'path';

/**
 * Everything in here has to be in place BEFORE `../main` is required: main.ts is a boot script, so
 * the whole file is a side effect — it registers an `uncaughtException` handler at module scope and
 * ends in `void bootstrap()`. The mocks below therefore stand in for the parts of the boot that
 * cannot run inside a test process (Nest DI container, Swagger generation, the seed child process),
 * while everything main.ts actually decides itself (middleware order, environment branches, signal
 * handling, seed output handling) stays real.
 *
 * None of the factories dereference the module-scoped `let`s below at factory time — they only close
 * over the bindings and read them when the mock is *called*, i.e. during a test. That keeps them
 * safe regardless of how ts-jest orders the hoisted `jest.mock` calls against the initializers.
 */

interface LogEntry {
  context: string;
  level: 'critical' | 'error' | 'warn' | 'info' | 'verbose';
  message: string;
}

interface AppMock {
  use: jest.Mock;
  listen: jest.Mock;
  get: jest.Mock;
  select: jest.Mock;
  enableVersioning: jest.Mock;
  useGlobalPipes: jest.Mock;
  useGlobalFilters: jest.Mock;
  useWebSocketAdapter: jest.Mock;
  getHttpServer: jest.Mock;
}

type MorganToken = (req: unknown, res: unknown) => string | undefined;
type SignalListener = (...args: unknown[]) => void;

// Filled by loadMain() / the mocks, read by the tests.
let logs: LogEntry[] = [];
let app: AppMock;
let serverClose: jest.Mock;
let leasesShutdown: jest.Mock;
let pricingOnModuleInit: jest.Mock;
let seedResult: SpawnSyncReturns<Buffer>;
let spawnSyncCalls: unknown[][] = [];
let morganTokens: Map<string, MorganToken> = new Map();
let handlers: Map<string, SignalListener[]> = new Map();
let swaggerSetupArgs: unknown[] = [];
let swaggerBuilderCalls: Array<[string, unknown]> = [];
let exitSpy: jest.SpyInstance;

// The three boot imports only exist for their side effects (OTel SDK start, event-loop gauges,
// global EventSource) — all of which are covered by their own specs and none of which may run a
// second time per test case here.
jest.mock('../tracing', () => ({}));
jest.mock('../runtime-metrics', () => ({}));
jest.mock('../polyfills', () => ({}));

// The real AppModule pulls in the entire application graph (and its providers' boot side effects);
// main.ts only ever passes it on as a token.
jest.mock('../app.module', () => ({ AppModule: class AppModule {} }));

// Stand-ins for the two providers main.ts resolves out of the container. Kept as named classes so
// the `app.get` mock can still verify that main.ts asks for the right token.
jest.mock('../shared/services/cron-lease.service', () => ({ CronLeaseService: class CronLeaseService {} }));
jest.mock('../subdomains/supporting/pricing/services/pricing.service', () => ({
  PricingService: class PricingService {},
}));

// Recording logger: main.ts's observable output is its log lines, and the real one writes through
// Nest's Logger to stdout. `LogLevel` is kept real because other modules in the graph import it.
jest.mock('../shared/services/dfx-logger', () => ({
  ...jest.requireActual('../shared/services/dfx-logger'),
  DfxLogger: class DfxLogger {
    private readonly context: string;

    constructor(context?: { name: string } | string) {
      this.context = typeof context === 'string' ? context : (context?.name ?? '');
    }

    private record(level: LogEntry['level'], message: string): void {
      logs.push({ context: this.context, level, message });
    }

    critical(message: string): void {
      this.record('critical', message);
    }
    error(message: string): void {
      this.record('error', message);
    }
    warn(message: string): void {
      this.record('warn', message);
    }
    info(message: string): void {
      this.record('info', message);
    }
    verbose(message: string): void {
      this.record('verbose', message);
    }
  },
}));

// Only NestFactory is replaced: @nestjs/platform-ws and the filters/pipes in the graph load the
// real @nestjs/core internals.
jest.mock('@nestjs/core', () => ({
  ...jest.requireActual('@nestjs/core'),
  NestFactory: { create: jest.fn(() => Promise.resolve(app)) },
}));

// Only the document generation is replaced (it would walk a real DI container); the decorators the
// webhook DTOs in main.ts's `extraModels` list use must stay real.
jest.mock('@nestjs/swagger', () => ({
  ...jest.requireActual('@nestjs/swagger'),
  DocumentBuilder: class DocumentBuilder {
    private call(name: string, value: unknown): this {
      swaggerBuilderCalls.push([name, value]);
      return this;
    }
    setTitle(title: string): this {
      return this.call('setTitle', title);
    }
    setDescription(description: string): this {
      return this.call('setDescription', description);
    }
    setExternalDoc(name: string, url: string): this {
      return this.call('setExternalDoc', [name, url]);
    }
    setVersion(version: string): this {
      return this.call('setVersion', version);
    }
    addBearerAuth(): this {
      return this.call('addBearerAuth', undefined);
    }
    build(): unknown {
      return { swaggerOptions: true };
    }
  },
  SwaggerModule: {
    createDocument: jest.fn(() => ({ swaggerDocument: true })),
    setup: jest.fn((...args: unknown[]) => {
      swaggerSetupArgs = args;
    }),
  },
}));

// morgan writes an access line per request and its token registry is module-global; capturing the
// token instead lets the `url` masking be exercised directly.
jest.mock('morgan', () => {
  const morgan = jest.fn(() => function morganHandler() {});
  return {
    __esModule: true,
    default: Object.assign(morgan, {
      token: (name: string, fn: MorganToken) => {
        morganTokens.set(name, fn);
        return morgan;
      },
    }),
  };
});

// The seed is a real `node` child process in LOC; only its result shape matters to main.ts.
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawnSync: (...args: unknown[]) => {
    spawnSyncCalls.push(args);
    return seedResult;
  },
}));

// Imported for the enum values only — main.ts compares against the real `Environment`, so a
// hand-written copy of it here would make those comparisons vacuous. Loaded outside the isolated
// registries on purpose: the members are plain strings, so identity across registries is irrelevant.
import { Environment } from '../config/config';

// Every case re-executes main.ts's whole module graph from a reset registry (config.ts, express,
// @nestjs/core, …). That is well inside Jest's default 5s budget on an idle machine but not on a
// loaded one, and the main suite sets no testTimeout of its own.
jest.setTimeout(60000);

const CAPTURED_EVENTS = ['uncaughtException', 'SIGTERM', 'SIGINT'];

// A jest worker reuses its process for the spec files that follow, so the environment loadMain()
// switches has to be handed back exactly as it was found (see afterAll).
const originalEnvironment = process.env.ENVIRONMENT;

function seedReturn(overrides: Partial<SpawnSyncReturns<Buffer>>): SpawnSyncReturns<Buffer> {
  return {
    pid: 4711,
    output: [],
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    status: 0,
    signal: null,
    ...overrides,
  } as SpawnSyncReturns<Buffer>;
}

function buildApp(): AppMock {
  serverClose = jest.fn();
  leasesShutdown = jest.fn(() => Promise.resolve());
  pricingOnModuleInit = jest.fn(() => Promise.resolve());

  return {
    use: jest.fn(),
    listen: jest.fn(() => Promise.resolve()),
    get: jest.fn((token: { name?: string }) => {
      switch (token?.name) {
        case 'CronLeaseService':
          return { shutdown: () => leasesShutdown() };
        case 'PricingService':
          return { onModuleInit: () => pricingOnModuleInit() };
        default:
          throw new Error(`Unexpected app.get token: ${String(token?.name ?? token)}`);
      }
    }),
    select: jest.fn(() => ({ get: jest.fn() })),
    enableVersioning: jest.fn(),
    useGlobalPipes: jest.fn(),
    useGlobalFilters: jest.fn(),
    useWebSocketAdapter: jest.fn(),
    getHttpServer: jest.fn(() => ({ close: serverClose })),
  };
}

function listener(event: string): SignalListener {
  const registered = handlers.get(event) ?? [];
  expect(registered).toHaveLength(1);

  return registered[0];
}

/** Lets every already-resolved promise chain main.ts started settle (setImmediate runs after the
 *  microtask queue is drained), since nothing exports `bootstrap()`'s promise. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

async function loadMain(environment: Environment): Promise<void> {
  process.env.ENVIRONMENT = environment;
  app = buildApp();

  jest.resetModules();

  // A reset registry gets its own copy of config.ts, where `Config` is an uninitialised `let` until
  // a ConfigService is constructed — so that has to happen in this registry, before main.ts reads it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ConfigService } = require('../config/config') as typeof import('../config/config');
  new ConfigService();

  // require, not import: the point is to re-execute the module body per case.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../main');

  await settle();
}

beforeEach(() => {
  logs = [];
  spawnSyncCalls = [];
  morganTokens = new Map();
  handlers = new Map();
  swaggerSetupArgs = [];
  swaggerBuilderCalls = [];
  seedResult = seedReturn({});

  // Both would end the test run: main.ts exits the process on an uncaught exception and on every
  // shutdown path. Capturing the registrations instead of performing them also keeps main.ts's
  // handlers from leaking into the suites that run after this file.
  exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as unknown as typeof process.exit);

  const realOn = process.on.bind(process);
  jest.spyOn(process, 'on').mockImplementation(((event: string, fn: SignalListener) => {
    if (!CAPTURED_EVENTS.includes(event)) return realOn(event as NodeJS.Signals, fn);

    handlers.set(event, [...(handlers.get(event) ?? []), fn]);
    return process;
  }) as unknown as typeof process.on);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  if (originalEnvironment === undefined) delete process.env.ENVIRONMENT;
  else process.env.ENVIRONMENT = originalEnvironment;
});

describe('uncaughtException handler', () => {
  let onUncaught: SignalListener;

  beforeEach(async () => {
    await loadMain(Environment.DEV);
    onUncaught = listener('uncaughtException');
    logs = []; // drop bootstrap's own lines, so each case asserts on the handler's output alone
  });

  it('keeps the process alive for a Spark SDK error identified by its constructor', () => {
    class SparkTransportError extends Error {}
    onUncaught(new SparkTransportError('grpc failure'));

    expect(exitSpy).not.toHaveBeenCalled();
    expect(logs).toEqual([
      { context: 'UncaughtException', level: 'error', message: 'Spark SDK uncaught exception (process kept alive):' },
    ]);
  });

  it('keeps the process alive for the Spark channel shutdown message on a plain Error', () => {
    // The SDK throws this one from a generic Error, so the constructor name says nothing.
    onUncaught(new Error('Channel has been shut down'));

    expect(exitSpy).not.toHaveBeenCalled();
    expect(logs[0].message).toBe('Spark SDK uncaught exception (process kept alive):');
  });

  it('shuts down on any other error', () => {
    onUncaught(new Error('boom'));

    expect(logs).toEqual([
      { context: 'UncaughtException', level: 'error', message: 'Uncaught exception, shutting down:' },
    ]);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it.each<[string, unknown]>([
    // Node hands the handler whatever was thrown, so none of the three property reads on the way to
    // `.includes` is guaranteed to exist.
    ['a missing error', undefined],
    ['a prototype-less object (no constructor)', Object.create(null)],
    ['an error whose constructor has no name and no message', { constructor: {} }],
  ])('shuts down on %s rather than throwing inside the handler', (_name, error) => {
    onUncaught(error);

    expect(logs[0].message).toBe('Uncaught exception, shutting down:');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('bootstrap', () => {
  it('registers the middleware chain in the order the routes depend on', async () => {
    await loadMain(Environment.DEV);

    // Only the paths are asserted, not the handler identities: the order is the contract here —
    // the raw-body routes must be mounted before the catch-all JSON parser, or they would already
    // have a parsed body by the time they are reached.
    expect(app.use.mock.calls.map((call) => (typeof call[0] === 'string' ? call[0] : '(handler)'))).toEqual([
      '(handler)', // morgan
      '(handler)', // helmet
      '(handler)', // cors
      '(handler)', // realIp
      '/v2/kyc/ident/sumsub',
      '/v1/alchemy/addressWebhook',
      '/v1/tatum/addressWebhook',
      '/v1/bank/fiatRepublic/webhook',
      '*',
      '/v1/node/*/rpc',
      '(handler)', // apiTraceMiddleware (DEV/PRD only)
    ]);
  });

  it('mounts a raw body parser on the Fiat Republic webhook', async () => {
    await loadMain(Environment.DEV);

    // Fiat Republic signs a digest of the exact bytes it sent, so a re-serialised body would fail
    // verification: this route must not be handled by the '*' JSON parser below it.
    const [path, handler] = app.use.mock.calls.find((call) => call[0] === '/v1/bank/fiatRepublic/webhook');
    expect(path).toBe('/v1/bank/fiatRepublic/webhook');
    expect(typeof handler).toBe('function');
    // express names its body parsers after the type they produce.
    expect((handler as { name: string }).name).toBe('rawParser');
  });

  it.each([Environment.DEV, Environment.PRD])('enables the api trace middleware in %s', async (environment) => {
    await loadMain(environment);

    expect(app.use).toHaveBeenCalledTimes(11);
  });

  it('leaves the api trace middleware off in loc', async () => {
    await loadMain(Environment.LOC);

    expect(app.use).toHaveBeenCalledTimes(10);
  });

  it('configures versioning, pipes, filters, the ws adapter and the swagger document', async () => {
    await loadMain(Environment.PRD);

    expect(app.enableVersioning).toHaveBeenCalledWith(expect.objectContaining({ defaultVersion: ['1'] }));
    expect(app.useGlobalPipes).toHaveBeenCalledTimes(1);
    expect(app.useGlobalFilters).toHaveBeenCalledTimes(1);
    expect(app.useWebSocketAdapter).toHaveBeenCalledTimes(1);
    expect(app.select).toHaveBeenCalledTimes(1);

    expect(swaggerBuilderCalls).toEqual([
      ['setTitle', 'DFX API'],
      ['setDescription', expect.stringContaining('DFX API PRD')],
      ['setExternalDoc', ['Github documentation', 'https://github.com/DFXswiss/api#dfx-api']],
      ['setVersion', 'v1'],
      ['addBearerAuth', undefined],
    ]);
    expect(swaggerSetupArgs).toEqual(['/swagger', app, { swaggerDocument: true }]);
  });

  it('listens on the configured port and reports readiness', async () => {
    await loadMain(Environment.PRD);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Config } = require('../config/config') as typeof import('../config/config');
    expect(app.listen).toHaveBeenCalledWith(Config.port);
    expect(logs).toContainEqual({ context: 'Main', level: 'info', message: 'Application ready ...' });
  });

  it('does not seed or re-initialize pricing outside of loc', async () => {
    await loadMain(Environment.DEV);

    expect(spawnSyncCalls).toHaveLength(0);
    expect(app.get).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'PricingService' }));
  });

  it('re-initializes the pricing fiat map after seeding in loc', async () => {
    await loadMain(Environment.LOC);

    // The seed inserts the fiats, so PricingService's own onModuleInit (which ran during
    // NestFactory.create, before the seed) built an empty map.
    expect(pricingOnModuleInit).toHaveBeenCalledTimes(1);
    expect(spawnSyncCalls).toHaveLength(1);
    // Seeding has to be finished before the port opens, or the first request can hit empty tables.
    expect(app.listen).toHaveBeenCalledTimes(1);
  });
});

describe('morgan url token', () => {
  let urlToken: MorganToken;

  beforeEach(async () => {
    await loadMain(Environment.DEV);
    urlToken = morganTokens.get('url');
  });

  it('replaces the built-in url token so the access log is masked too', () => {
    expect(morganTokens.size).toBe(1);
    expect(urlToken).toBeDefined();
  });

  it('masks the query string and wallet addresses of the original url', () => {
    const masked = urlToken({ originalUrl: '/v1/buy/paymentInfos?iban=CH9300762011623852957' } as Request, undefined);

    expect(masked).not.toContain('CH9300762011623852957');
    expect(masked).toContain('/v1/buy/paymentInfos');
  });

  it('falls back to url when express has not set originalUrl', () => {
    // The token also runs for requests morgan sees outside the express router.
    expect(urlToken({ url: '/v1/currency' }, undefined)).toBe('/v1/currency');
  });

  it('renders an empty string when neither url is present', () => {
    expect(urlToken({}, undefined)).toBe('');
  });
});

describe('realIp middleware', () => {
  it('resolves the verified client ip onto the request and continues the chain', async () => {
    await loadMain(Environment.DEV);

    // The 4th single-argument use() call, see the middleware order asserted above.
    const middleware = app.use.mock.calls[3][0] as (req: unknown, res: unknown, next: () => void) => void;
    const req = { headers: { 'cf-connecting-ip': '203.0.113.7' }, socket: {} };
    const next = jest.fn();

    middleware(req, {}, next);

    expect((req as { realIp?: string }).realIp).toBe('203.0.113.7');
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('releaseCronLeasesOnShutdown', () => {
  it.each(['SIGTERM', 'SIGINT'])('releases the cron leases on %s and then exits', async (signal) => {
    await loadMain(Environment.DEV);

    listener(signal)();
    // Closing the listener is deliberately not awaited, so it has happened by now.
    expect(serverClose).toHaveBeenCalledTimes(1);
    expect(leasesShutdown).toHaveBeenCalledTimes(1);
    expect(logs).toContainEqual({
      context: 'Shutdown',
      level: 'info',
      message: `${signal} received, releasing the cron leases`,
    });

    await settle();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('still exits when releasing the leases fails', async () => {
    await loadMain(Environment.DEV);
    leasesShutdown.mockReturnValue(Promise.reject(new Error('db gone')));

    listener('SIGTERM')();
    await settle();

    expect(logs).toContainEqual({
      context: 'Shutdown',
      level: 'error',
      message: 'Failed to release the cron leases on shutdown:',
    });
    // A failed handover must not hold the container until SIGKILL.
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('takes the impatient path on a second signal instead of waiting again', async () => {
    await loadMain(Environment.DEV);
    const onSigterm = listener('SIGTERM');

    onSigterm();
    logs = [];
    onSigterm();

    expect(logs[0]).toEqual({
      context: 'Shutdown',
      level: 'warn',
      message: 'Second SIGTERM, exiting without waiting for the running jobs',
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('runSeed', () => {
  it('logs every non-empty seed output line and reports success', async () => {
    seedResult = seedReturn({
      // The blank line is what a seed script's trailing newline / spacing produces; logging it
      // would only add empty lines to the pipeline.
      stdout: Buffer.from('inserting fiats\n\ninserting assets\n'),
      stderr: Buffer.alloc(0),
      status: 0,
    });

    await loadMain(Environment.LOC);

    expect(spawnSyncCalls[0]).toEqual([
      'node',
      [join(process.cwd(), 'migration', 'seed', 'seed.js')],
      { stdio: ['ignore', 'pipe', 'pipe'], env: process.env },
    ]);
    expect(logs.filter((entry) => entry.context === 'Seed')).toEqual([
      { context: 'Seed', level: 'info', message: 'Running database seed...' },
      { context: 'Seed', level: 'verbose', message: 'inserting fiats' },
      { context: 'Seed', level: 'verbose', message: 'inserting assets' },
      { context: 'Seed', level: 'info', message: 'Database seed completed' },
    ]);
  });

  it('reports the stderr output and the exit code of a failed seed', async () => {
    seedResult = seedReturn({ stdout: null, stderr: Buffer.from('duplicate key\n'), status: 1 });

    await loadMain(Environment.LOC);

    expect(logs.filter((entry) => entry.context === 'Seed')).toEqual([
      { context: 'Seed', level: 'info', message: 'Running database seed...' },
      { context: 'Seed', level: 'error', message: 'duplicate key' },
      { context: 'Seed', level: 'error', message: 'Database seed failed with code 1' },
    ]);
    // A failed seed is reported, not fatal: the API still comes up.
    expect(app.listen).toHaveBeenCalledTimes(1);
  });

  it('handles a seed that produced no output at all', async () => {
    // spawnSync leaves stdout/stderr null when the child could not be spawned.
    seedResult = seedReturn({ stdout: null, stderr: null, status: null });

    await loadMain(Environment.LOC);

    expect(logs.filter((entry) => entry.context === 'Seed')).toEqual([
      { context: 'Seed', level: 'info', message: 'Running database seed...' },
      { context: 'Seed', level: 'error', message: 'Database seed failed with code null' },
    ]);
  });
});
