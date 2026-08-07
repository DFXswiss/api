import { metrics } from '@opentelemetry/api';
import { MetricService } from '../metric.service';

describe('MetricService', () => {
  const counterAdd = jest.fn();
  const histogramRecord = jest.fn();
  const gaugeAddCallback = jest.fn();
  const createCounter = jest.fn(() => ({ add: counterAdd }));
  const createHistogram = jest.fn(() => ({ record: histogramRecord }));
  const createObservableGauge = jest.fn(() => ({ addCallback: gaugeAddCallback }));

  beforeEach(() => {
    jest.spyOn(metrics, 'getMeter').mockReturnValue({
      createCounter,
      createHistogram,
      createObservableGauge,
    } as never);
    createCounter.mockClear();
    createHistogram.mockClear();
    createObservableGauge.mockClear();
    counterAdd.mockClear();
    histogramRecord.mockClear();
    gaugeAddCallback.mockClear();
  });

  afterEach(() => jest.restoreAllMocks());

  it('creates one counter per name and increments by 1 with attributes', () => {
    const service = new MetricService();
    const attributes = { job: 'Foo::bar' };

    service.increment('dfx_job_enqueued', attributes);
    service.increment('dfx_job_enqueued', attributes);

    expect(createCounter).toHaveBeenCalledTimes(1);
    expect(createCounter).toHaveBeenCalledWith('dfx_job_enqueued');
    expect(counterAdd).toHaveBeenCalledTimes(2);
    expect(counterAdd).toHaveBeenNthCalledWith(1, 1, attributes);
    expect(counterAdd).toHaveBeenNthCalledWith(2, 1, attributes);
  });

  it('creates one histogram per name and records value with unit and attributes', () => {
    const service = new MetricService();
    const attributes = { job: 'Foo::bar' };

    service.record('dfx_job_run_seconds', 1.5, 's', attributes);
    service.record('dfx_job_run_seconds', 2.25, 's', attributes);

    expect(createHistogram).toHaveBeenCalledTimes(1);
    expect(createHistogram).toHaveBeenCalledWith('dfx_job_run_seconds', { unit: 's' });
    expect(histogramRecord).toHaveBeenCalledTimes(2);
    expect(histogramRecord).toHaveBeenNthCalledWith(1, 1.5, attributes);
    expect(histogramRecord).toHaveBeenNthCalledWith(2, 2.25, attributes);
  });

  it('registers a gauge callback and rejects a second registration of the same name', () => {
    const service = new MetricService();
    const observe = jest.fn();

    service.registerGauge('dfx_job_seconds_since_last_run', 's', observe);

    expect(createObservableGauge).toHaveBeenCalledTimes(1);
    expect(createObservableGauge).toHaveBeenCalledWith('dfx_job_seconds_since_last_run', { unit: 's' });
    expect(gaugeAddCallback).toHaveBeenCalledTimes(1);
    expect(gaugeAddCallback).toHaveBeenCalledWith(observe);

    expect(() => service.registerGauge('dfx_job_seconds_since_last_run', 's', observe)).toThrow(
      "Gauge 'dfx_job_seconds_since_last_run' is already registered",
    );
    expect(createObservableGauge).toHaveBeenCalledTimes(1);
  });
});
