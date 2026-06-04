import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor, ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base';

// OpenTelemetry tracing for dfx-api.
//
// This module is imported first in main.ts so the SDK starts before any
// instrumented library (http, pg/TypeORM, …) is loaded — otherwise the
// auto-instrumentation cannot patch them. It replaces the previous App
// Insights setup; the exporter target is supplied exclusively through
// OTEL_EXPORTER_OTLP_ENDPOINT (no hardcoded collector address). When the
// variable is unset, tracing is disabled and the app boots unchanged.
//
// The exported helpers are pure and unit-tested; startTracing() has the side
// effect of registering the global SDK.

/**
 * HTTP 4xx (client error) check.
 */
export function isClientError(statusCode?: number): boolean {
  return statusCode != null && statusCode >= 400 && statusCode < 500;
}

function httpStatusCode(span: ReadableSpan): number | undefined {
  // Stable semconv first, then the legacy attribute.
  const value = span.attributes['http.response.status_code'] ?? span.attributes['http.status_code'];
  return value == null ? undefined : Number(value);
}

/**
 * Marks 4xx client errors as non-failures, replicating the old App Insights
 * telemetry processor (only 5xx are real server errors). OTel's HTTP server
 * instrumentation already leaves 4xx spans unset, but a request that logs via
 * DfxLogger.error would otherwise flip its own server span to ERROR — this
 * processor runs on span end (after instrumentation) and resets such 4xx
 * server spans back to UNSET, so the 5xx error-rate dashboards stay accurate.
 */
export class ClientErrorSpanProcessor implements SpanProcessor {
  onStart(): void {
    // no-op
  }

  onEnd(span: ReadableSpan): void {
    if (
      span.kind === SpanKind.SERVER &&
      span.status.code === SpanStatusCode.ERROR &&
      isClientError(httpStatusCode(span))
    ) {
      (span.status as { code: SpanStatusCode; message?: string }).code = SpanStatusCode.UNSET;
    }
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

let sdk: NodeSDK | undefined;

export function startTracing(): NodeSDK | undefined {
  // Disabled unless a collector endpoint is configured (e.g. on LOC / in tests).
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return undefined;
  if (sdk) return sdk;

  sdk = new NodeSDK({
    serviceName: 'dfx-api',
    // The 4xx-not-a-failure processor runs before the exporting batch
    // processor so corrected statuses are what gets exported. The exporter
    // reads OTEL_EXPORTER_OTLP_ENDPOINT from the environment.
    spanProcessors: [new ClientErrorSpanProcessor(), new BatchSpanProcessor(new OTLPTraceExporter())],
    instrumentations: [
      getNodeAutoInstrumentations({
        // Filesystem spans are pure noise for an API service.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  return sdk;
}

startTracing();
