// Thin facade over the OpenTelemetry Metrics API.
// Instrument names use underscores because the Prometheus exporter takes them
// as-is (and appends `_total` to counters).

import { Injectable } from '@nestjs/common';
import { Attributes, Counter, Histogram, metrics, ObservableResult } from '@opentelemetry/api';

@Injectable()
export class MetricService {
  // OTel returns a no-op meter when no SDK is registered, so this service does
  // not check whether metrics are enabled and has no fallback path.
  private readonly meter = metrics.getMeter('dfx-api');
  private readonly counters = new Map<string, Counter>();
  private readonly histograms = new Map<string, Histogram>();
  private readonly gaugeNames = new Set<string>();

  increment(name: string, attributes: Attributes): void {
    let counter = this.counters.get(name);
    if (!counter) {
      counter = this.meter.createCounter(name);
      this.counters.set(name, counter);
    }
    counter.add(1, attributes);
  }

  record(name: string, value: number, unit: string, attributes: Attributes): void {
    let histogram = this.histograms.get(name);
    if (!histogram) {
      histogram = this.meter.createHistogram(name, { unit });
      this.histograms.set(name, histogram);
    }
    histogram.record(value, attributes);
  }

  registerGauge(name: string, unit: string, observe: (result: ObservableResult) => void | Promise<void>): void {
    if (this.gaugeNames.has(name)) {
      throw new Error(`Gauge '${name}' is already registered`);
    }
    this.gaugeNames.add(name);
    this.meter.createObservableGauge(name, { unit }).addCallback(observe);
  }
}
