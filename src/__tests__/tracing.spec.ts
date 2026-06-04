const mockStart = jest.fn();

jest.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: jest.fn().mockImplementation(() => ({ start: mockStart })),
}));
jest.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: jest.fn(() => []),
}));
jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: jest.fn(),
}));

import { isClientError, startTracing } from '../tracing';

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

describe('startTracing', () => {
  const original = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  afterEach(() => {
    mockStart.mockClear();
    if (original === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = original;
  });

  it('is disabled (returns undefined) without OTEL_EXPORTER_OTLP_ENDPOINT', () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    expect(startTracing()).toBeUndefined();
  });

  it('starts the SDK when an endpoint is configured', () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    const sdk = startTracing();
    expect(sdk).toBeDefined();
    expect(mockStart).toHaveBeenCalledTimes(1);
  });
});
