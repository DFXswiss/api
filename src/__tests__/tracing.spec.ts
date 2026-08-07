const mockStart = jest.fn();
const mockPyroscopeInit = jest.fn();
const mockStartWallProfiling = jest.fn();

jest.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: jest.fn().mockImplementation(() => ({ start: mockStart })),
}));
jest.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: jest.fn(() => []),
}));
jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: jest.fn(),
}));
jest.mock('@opentelemetry/exporter-metrics-otlp-http', () => ({
  OTLPMetricExporter: jest.fn(),
}));
jest.mock('@opentelemetry/sdk-metrics', () => ({
  PeriodicExportingMetricReader: jest.fn(),
}));
jest.mock('@pyroscope/nodejs', () => ({
  __esModule: true,
  default: { init: mockPyroscopeInit, startWallProfiling: mockStartWallProfiling },
}));

import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { ClientErrorSpanProcessor, isClientError, startProfiling, startTracing, tracingServiceName } from '../tracing';

function fakeSpan(kind: SpanKind, statusCode: SpanStatusCode, httpStatus?: number): ReadableSpan {
  return {
    kind,
    status: { code: statusCode },
    attributes: httpStatus == null ? {} : { 'http.response.status_code': httpStatus },
  } as unknown as ReadableSpan;
}

describe('isClientError', () => {
  it.each([
    [400, true],
    [404, true],
    [499, true],
    [500, false],
    [503, false],
    [399, false],
    [200, false],
  ])('classifies %i as client error = %s', (code, expected) => {
    expect(isClientError(code)).toBe(expected);
  });

  it('treats a missing status code as not a client error', () => {
    expect(isClientError(undefined)).toBe(false);
  });
});

describe('ClientErrorSpanProcessor', () => {
  const processor = new ClientErrorSpanProcessor();

  it('resets a 4xx SERVER span that was marked ERROR back to UNSET', () => {
    const span = fakeSpan(SpanKind.SERVER, SpanStatusCode.ERROR, 404);
    processor.onEnd(span);
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
  });

  it('keeps 5xx SERVER spans as ERROR', () => {
    const span = fakeSpan(SpanKind.SERVER, SpanStatusCode.ERROR, 500);
    processor.onEnd(span);
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('does not touch CLIENT spans (outbound dependency 4xx stay visible)', () => {
    const span = fakeSpan(SpanKind.CLIENT, SpanStatusCode.ERROR, 404);
    processor.onEnd(span);
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
  });

  it('leaves an already non-error 4xx span untouched', () => {
    const span = fakeSpan(SpanKind.SERVER, SpanStatusCode.UNSET, 404);
    processor.onEnd(span);
    expect(span.status.code).toBe(SpanStatusCode.UNSET);
  });
});

describe('startTracing', () => {
  const original = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  afterEach(() => {
    mockStart.mockClear();
    (PeriodicExportingMetricReader as unknown as jest.Mock).mockClear();
    if (original === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = original;
  });

  it('is disabled (returns undefined) without OTEL_EXPORTER_OTLP_ENDPOINT', () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    expect(startTracing()).toBeUndefined();
  });

  it('returns undefined and does not build a metric reader without OTEL_EXPORTER_OTLP_ENDPOINT', () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    (PeriodicExportingMetricReader as unknown as jest.Mock).mockClear();

    expect(startTracing()).toBeUndefined();
    expect(PeriodicExportingMetricReader).not.toHaveBeenCalled();
  });

  it('starts the SDK when an endpoint is configured', () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    const sdk = startTracing();
    expect(sdk).toBeDefined();
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  // The interval is deliberately NOT pinned in code: an explicit reader takes precedence over the
  // SDK's own env handling, so passing a hardcoded value would silently disable
  // OTEL_METRIC_EXPORT_INTERVAL. Absent the variable the key must therefore be absent too, rather
  // than present with a default — those are different things to the SDK.
  it('constructs the metric reader once and leaves the interval to the SDK when unset', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    delete process.env.OTEL_METRIC_EXPORT_INTERVAL;
    (PeriodicExportingMetricReader as unknown as jest.Mock).mockClear();

    // Re-import in isolation so the module-level sdk cache is empty and the
    // module-level startTracing() runs with the endpoint set.
    let isolatedStart: typeof startTracing;
    await jest.isolateModulesAsync(async () => {
      isolatedStart = (await import('../tracing')).startTracing;
    });

    expect(PeriodicExportingMetricReader).toHaveBeenCalledTimes(1);
    expect(PeriodicExportingMetricReader).toHaveBeenCalledWith(
      expect.not.objectContaining({ exportIntervalMillis: expect.anything() }),
    );

    // Calling again must not construct a second reader (singleton).
    isolatedStart!();
    expect(PeriodicExportingMetricReader).toHaveBeenCalledTimes(1);
  });

  it('passes OTEL_METRIC_EXPORT_INTERVAL through to the reader when set', async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    process.env.OTEL_METRIC_EXPORT_INTERVAL = '30000';
    (PeriodicExportingMetricReader as unknown as jest.Mock).mockClear();

    await jest.isolateModulesAsync(async () => {
      await import('../tracing');
    });

    expect(PeriodicExportingMetricReader).toHaveBeenCalledWith(
      expect.objectContaining({ exportIntervalMillis: 30000 }),
    );

    delete process.env.OTEL_METRIC_EXPORT_INTERVAL;
  });
});

describe('tracingServiceName', () => {
  const original = process.env.CRON_ROLE;

  afterEach(() => {
    if (original === undefined) delete process.env.CRON_ROLE;
    else process.env.CRON_ROLE = original;
  });

  it('reports the worker under its own name', () => {
    // Both processes run the same image and would otherwise report as one service, leaving a
    // consumer of the traces unable to tell them apart.
    process.env.CRON_ROLE = 'worker';
    expect(tracingServiceName()).toBe('dfx-api-worker');
  });

  it.each(['api', 'all', undefined])('reports %p as the API service', (role) => {
    if (role === undefined) delete process.env.CRON_ROLE;
    else process.env.CRON_ROLE = role;

    expect(tracingServiceName()).toBe('dfx-api');
  });
});

// Every case loads its own copy of the module: importing tracing.ts calls
// startProfiling() as a side effect, and the module latches `profiling` after
// the first successful start. A fresh registry per case keeps that latch — the
// thing being tested — from leaking between them.
describe('startProfiling', () => {
  const originalAddress = process.env.PYROSCOPE_SERVER_ADDRESS;
  const originalEnvironment = process.env.ENVIRONMENT;
  const originalCronRole = process.env.CRON_ROLE;

  function loadTracing(): { startProfiling: () => boolean } {
    let loaded: { startProfiling: () => boolean };
    jest.isolateModules(() => {
      // require, not import: isolateModules is synchronous and the point is to
      // re-execute the module body (and with it its start-up side effects).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loaded = require('../tracing');
    });

    return loaded;
  }

  beforeEach(() => {
    mockPyroscopeInit.mockReset();
    mockStartWallProfiling.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();

    if (originalAddress === undefined) delete process.env.PYROSCOPE_SERVER_ADDRESS;
    else process.env.PYROSCOPE_SERVER_ADDRESS = originalAddress;

    if (originalEnvironment === undefined) delete process.env.ENVIRONMENT;
    else process.env.ENVIRONMENT = originalEnvironment;

    if (originalCronRole === undefined) delete process.env.CRON_ROLE;
    else process.env.CRON_ROLE = originalCronRole;
  });

  it('is disabled (returns false) without PYROSCOPE_SERVER_ADDRESS', () => {
    delete process.env.PYROSCOPE_SERVER_ADDRESS;
    process.env.ENVIRONMENT = 'prd';

    expect(startProfiling()).toBe(false);
    expect(mockPyroscopeInit).not.toHaveBeenCalled();
    expect(mockStartWallProfiling).not.toHaveBeenCalled();
  });

  it('starts the wall profiler with the environment tag and CPU time enabled', () => {
    process.env.PYROSCOPE_SERVER_ADDRESS = 'http://localhost:4040';
    process.env.ENVIRONMENT = 'prd';
    delete process.env.CRON_ROLE;

    const tracing = loadTracing();

    expect(mockPyroscopeInit).toHaveBeenCalledWith({
      appName: 'dfx-api',
      serverAddress: 'http://localhost:4040',
      tags: { env: 'prd' },
      wall: { collectCpuTime: true },
    });
    // Once for the module-level call, and not again on the explicit one:
    // starting a second sampler would double the profiling cost.
    expect(tracing.startProfiling()).toBe(true);
    expect(mockStartWallProfiling).toHaveBeenCalledTimes(1);
  });

  it('profiles the worker under its own app name', () => {
    // The two roles run the same image and both configure a server address, so a constant appName
    // would file both sets of samples under one service and merge the flame graphs.
    process.env.PYROSCOPE_SERVER_ADDRESS = 'http://localhost:4040';
    process.env.ENVIRONMENT = 'prd';
    process.env.CRON_ROLE = 'worker';

    loadTracing();

    expect(mockPyroscopeInit).toHaveBeenCalledWith(expect.objectContaining({ appName: 'dfx-api-worker' }));
  });

  it('reports the failure and keeps running when ENVIRONMENT is missing', () => {
    process.env.PYROSCOPE_SERVER_ADDRESS = 'http://localhost:4040';
    delete process.env.ENVIRONMENT;

    const tracing = loadTracing();

    expect(tracing.startProfiling()).toBe(false);
    expect(mockStartWallProfiling).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it('reports the failure and keeps running when the SDK throws', () => {
    process.env.PYROSCOPE_SERVER_ADDRESS = 'http://localhost:4040';
    process.env.ENVIRONMENT = 'prd';
    mockPyroscopeInit.mockImplementation(() => {
      throw new Error('boom');
    });

    const tracing = loadTracing();

    expect(tracing.startProfiling()).toBe(false);
    expect(mockStartWallProfiling).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });
});
