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

import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { ClientErrorSpanProcessor, isClientError, startTracing } from '../tracing';

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
