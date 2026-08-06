import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
// Pinned to an exact version in package.json, not a range: the exporter and the NodeSDK below
// both depend on one exact @opentelemetry/sdk-metrics, so a range resolving higher installs a
// second copy beside theirs. The reader constructed here would then come from a different copy of
// the package than the one the SDK reads it as, and nothing in the build says so - the types are
// structural and match either way. Raise the pin together with @opentelemetry/sdk-node.
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor, ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base';
import Pyroscope from '@pyroscope/nodejs';

// OpenTelemetry tracing and continuous CPU profiling for dfx-api.
//
// This module is imported first in main.ts so the SDK starts before any
// instrumented library (http, pg/TypeORM, …) is loaded — otherwise the
// auto-instrumentation cannot patch them. It replaces the previous App
// Insights setup; the exporter target is supplied exclusively through
// OTEL_EXPORTER_OTLP_ENDPOINT (no hardcoded collector address). When the
// variable is unset, tracing is disabled and the app boots unchanged.
//
// Profiling follows the same rule with its own variable
// (PYROSCOPE_SERVER_ADDRESS) and answers a different question: tracing measures
// how long a request waited, profiling measures what burned the CPU while it
// ran. The two are independent — either can be enabled without the other.
//
// The exported helpers are pure and unit-tested; startTracing() and
// startProfiling() have the side effect of registering a global SDK.

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

/**
 * Metric export interval in milliseconds.
 *
 * Deliberately left to OTEL_METRIC_EXPORT_INTERVAL (the SDK's own variable, default 60s) rather
 * than pinned in code. An explicit reader takes precedence over the SDK's env handling, so a
 * hardcoded value would silently disable that knob — and a shorter interval costs a full
 * collect-and-export of *every* instrument, including the auto-instrumentation histograms, on
 * the very event loop this is meant to keep free.
 */
export function metricExportIntervalMs(): number | undefined {
  const raw = process.env.OTEL_METRIC_EXPORT_INTERVAL;
  if (raw == null || raw === '') return undefined;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid OTEL_METRIC_EXPORT_INTERVAL value '${raw}': expected a positive number of milliseconds`);
  }

  return parsed;
}

let sdk: NodeSDK | undefined;

/**
 * Whether telemetry export is configured at all. Shared with src/runtime-metrics.ts so both
 * halves switch on the same condition — the metrics live in the meter provider this module
 * registers, and a second copy of the check would drift the moment this one changes.
 */
export function isTelemetryEnabled(): boolean {
  return Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
}

/**
 * Maps CRON_ROLE to the service name reported with every span, so spans from the worker role are
 * distinguishable from the rest instead of arriving under one name.
 *
 * Reads the environment directly rather than the configuration: startTracing runs before the
 * application is created, and importing the configuration here would load the instrumented
 * modules before the SDK patches them. The value itself is validated in config.ts.
 */
export function tracingServiceName(): string {
  return process.env.CRON_ROLE === 'worker' ? 'dfx-api-worker' : 'dfx-api';
}

export function startTracing(): NodeSDK | undefined {
  // Disabled unless a collector endpoint is configured (e.g. on LOC / in tests).
  if (!isTelemetryEnabled()) return undefined;
  if (sdk) return sdk;

  const intervalMs = metricExportIntervalMs();

  sdk = new NodeSDK({
    serviceName: tracingServiceName(),
    // The 4xx-not-a-failure processor runs before the exporting batch
    // processor so corrected statuses are what gets exported. The exporter
    // reads OTEL_EXPORTER_OTLP_ENDPOINT from the environment.
    spanProcessors: [new ClientErrorSpanProcessor(), new BatchSpanProcessor(new OTLPTraceExporter())],
    // Metrics travel the same OTLP route as spans, so runtime saturation (see
    // src/runtime-metrics.ts) needs no extra endpoint or scrape target. Spans measure how long
    // work waited; these measure whether the process had CPU to run it at all.
    //
    // The reader is declared explicitly because the gauges need a meter provider that is
    // guaranteed to exist; the interval stays env-driven so this does not quietly change the
    // export cadence the SDK would otherwise use.
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      ...(intervalMs == null ? {} : { exportIntervalMillis: intervalMs }),
    }),
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

let profiling = false;

/**
 * Starts continuous CPU profiling and returns whether the profiler is running.
 *
 * Disabled unless PYROSCOPE_SERVER_ADDRESS points at a Pyroscope instance, so
 * LOC, tests and any environment without one boot untouched.
 */
export function startProfiling(): boolean {
  if (!process.env.PYROSCOPE_SERVER_ADDRESS) return false;
  if (profiling) return true;

  try {
    // dev and prd push to the same Pyroscope, exactly as they push to the same
    // Tempo, so the profiles need a label that tells them apart. ENVIRONMENT is
    // the variable the rest of the app already keys off (see config.ts), which
    // keeps this from becoming a second source of truth. Checked explicitly
    // because the SDK would otherwise reject the undefined tag value with a
    // message that says nothing about where it came from.
    const environment = process.env.ENVIRONMENT;
    if (!environment) throw new Error('ENVIRONMENT is not set — profiles could not be told apart per environment');

    Pyroscope.init({
      // Becomes the service_name label Pyroscope indexes by, and derived from the same helper as
      // the OTel serviceName above so a trace and a profile of the same process carry the same
      // name. It has to be the role-aware name, not a constant: the HTTP container and the worker
      // run the same image and both set PYROSCOPE_SERVER_ADDRESS, so a constant would merge two
      // very differently-shaped workloads into one flame graph — and telling them apart is the
      // question profiling was added to answer.
      appName: tracingServiceName(),
      serverAddress: process.env.PYROSCOPE_SERVER_ADDRESS,
      tags: { env: environment },
      // Without collectCpuTime the wall profiler reports elapsed time, which
      // for an event loop that is mostly waiting says little. With it, the
      // `wall:cpu:nanoseconds:wall:nanoseconds` series carries actual CPU time
      // — the series to chart.
      //
      // Sampling stays at the 100 Hz default on purpose. Measured on a
      // CPU-saturated Node process, halving it to 50 Hz changed throughput by
      // less than the run-to-run spread (-4.3 % vs -4.6 % against no profiler):
      // the cost is in the sampler being installed at all, not in the sample
      // rate, so turning it down buys resolution loss and nothing else.
      wall: { collectCpuTime: true },
    });

    // Wall/CPU only. Heap profiling is a second sampler with its own cost and
    // is deliberately left off: this exists to attribute CPU time. Enable it
    // via Pyroscope.startHeapProfiling() if allocation sites become the
    // question.
    Pyroscope.startWallProfiling();
    profiling = true;

    return true;
  } catch (e) {
    // The profiler is an observability extra; it must never be the reason the
    // API fails to boot. Loud rather than silent: the line lands in Loki, and
    // the absence of profiles in Grafana is the second signal.
    //
    // console is the only channel that exists here: this module runs before
    // Nest is bootstrapped, so DfxLogger is not available, and OTel's diag
    // logger is a no-op unless a sink is registered — which would turn a
    // failure into silence.
    // eslint-disable-next-line no-console
    console.error('Continuous profiling disabled — Pyroscope failed to start:', e);

    return false;
  }
}

startTracing();
startProfiling();
