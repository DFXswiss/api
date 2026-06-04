import { SpanStatusCode } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ServerResponse } from 'http';

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
 * HTTP 4xx (client error) check. dfx-api marks 4xx server spans as successful
 * so they are not counted as failures — the OpenTelemetry equivalent of the
 * old App Insights telemetry processor (only 5xx are real server errors).
 */
export function isClientError(statusCode?: number): boolean {
  return statusCode != null && statusCode >= 400 && statusCode < 500;
}

let sdk: NodeSDK | undefined;

export function startTracing(): NodeSDK | undefined {
  // Disabled unless a collector endpoint is configured (e.g. on LOC / in tests).
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return undefined;
  if (sdk) return sdk;

  sdk = new NodeSDK({
    serviceName: 'dfx-api',
    // Reads OTEL_EXPORTER_OTLP_ENDPOINT from the environment and posts spans
    // to <endpoint>/v1/traces.
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Filesystem spans are pure noise for an API service.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          // Mark incoming 4xx responses as non-failures (App Insights parity).
          // Only server responses are touched; outbound client 4xx keep their
          // default status so dependency failures stay visible.
          responseHook: (span, response) => {
            if (response instanceof ServerResponse && isClientError(response.statusCode)) {
              span.setStatus({ code: SpanStatusCode.OK });
            }
          },
        },
      }),
    ],
  });

  sdk.start();

  return sdk;
}

startTracing();
