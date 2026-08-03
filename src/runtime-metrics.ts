import { metrics } from '@opentelemetry/api';
import { EventLoopUtilization, IntervalHistogram, monitorEventLoopDelay, performance } from 'perf_hooks';
import { isTelemetryEnabled } from './tracing';

// Node runtime saturation metrics for dfx-api.
//
// Traces answer "how long did this request take"; they cannot answer "why". A request that
// waits behind a saturated event loop looks identical to one waiting on a slow query. These
// metrics close that gap: they measure whether the single JS thread had capacity at all.
//
// MonitorEventLoopService logs the same figures for humans, but it runs as a cron job — an
// HTTP-only instance (CRON_JOBS_ENABLED=false) registers no jobs and would therefore report
// nothing exactly where saturation matters most. The collection here is driven by the OTel
// metric reader instead, so it is independent of the scheduler and runs on every instance.
//
// Export travels the existing OTLP pipeline (see src/tracing.ts). With
// OTEL_EXPORTER_OTLP_ENDPOINT unset, no meter is registered and the app boots unchanged.

const NS_PER_S = 1e9;

/** Instrument names follow the OpenTelemetry Node.js runtime semantic conventions. */
export const METER_NAME = 'dfx-api.runtime';

export interface EventLoopDelay {
  min: number;
  max: number;
  mean: number;
  p50: number;
  p90: number;
  p99: number;
}

export interface EventLoopSample {
  /** Fraction of the interval the loop was busy, 0..1. */
  utilization: number;
  /** Delay percentiles in seconds, per semantic conventions. */
  delay: EventLoopDelay;
}

/**
 * Converts a histogram reading plus an utilization delta into one sample.
 *
 * Pure on purpose: the caller owns both the histogram reset and the utilization reference, so
 * this stays unit-testable without timers. An empty histogram (no sample taken yet) reports
 * zeros rather than the `Infinity`/`0` pair Node returns for `min`/`max` in that state, which
 * would otherwise poison the exported series.
 */
export function toEventLoopSample(histogram: IntervalHistogram, utilization: number): EventLoopSample {
  const empty = histogram.count === 0;
  const seconds = (ns: number) => (empty ? 0 : ns / NS_PER_S);

  return {
    utilization,
    delay: {
      min: seconds(histogram.min),
      max: seconds(histogram.max),
      mean: seconds(histogram.mean),
      p50: seconds(histogram.percentile(50)),
      p90: seconds(histogram.percentile(90)),
      p99: seconds(histogram.percentile(99)),
    },
  };
}

let started = false;

/**
 * Registers the runtime gauges. Returns whether they are active: false means telemetry is
 * switched off by configuration, in which case there is no meter provider to register with.
 */
export function startRuntimeMetrics(): boolean {
  if (!isTelemetryEnabled()) return false;
  if (started) return true;

  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();

  let previousElu: EventLoopUtilization = performance.eventLoopUtilization();

  const meter = metrics.getMeter(METER_NAME);

  const utilization = meter.createObservableGauge('nodejs.eventloop.utilization', {
    description: 'Event loop utilization over the last export interval',
  });
  const delayInstruments = {
    min: meter.createObservableGauge('nodejs.eventloop.delay.min', { unit: 's' }),
    max: meter.createObservableGauge('nodejs.eventloop.delay.max', { unit: 's' }),
    mean: meter.createObservableGauge('nodejs.eventloop.delay.mean', { unit: 's' }),
    p50: meter.createObservableGauge('nodejs.eventloop.delay.p50', { unit: 's' }),
    p90: meter.createObservableGauge('nodejs.eventloop.delay.p90', { unit: 's' }),
    p99: meter.createObservableGauge('nodejs.eventloop.delay.p99', { unit: 's' }),
  };

  // A batch callback fires once per collection for all instruments together. Registering one
  // callback per gauge would reset the histogram six times per interval, so every gauge but
  // the first would report an almost empty window.
  meter.addBatchObservableCallback(
    (observer) => {
      const currentElu = performance.eventLoopUtilization();
      const intervalElu = performance.eventLoopUtilization(currentElu, previousElu);
      const sample = toEventLoopSample(histogram, intervalElu.utilization);

      observer.observe(utilization, sample.utilization);
      for (const [key, instrument] of Object.entries(delayInstruments)) {
        observer.observe(instrument, sample.delay[key as keyof EventLoopDelay]);
      }

      // Advance both windows together so delay and utilization always describe the same
      // interval, and each export reports the interval just passed rather than the whole
      // process lifetime.
      previousElu = currentElu;
      histogram.reset();
    },
    [utilization, ...Object.values(delayInstruments)],
  );

  started = true;

  return true;
}

startRuntimeMetrics();
