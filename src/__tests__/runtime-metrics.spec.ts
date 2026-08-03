import { IntervalHistogram } from 'perf_hooks';
import { toEventLoopSample } from '../runtime-metrics';

const NS_PER_S = 1e9;

function fakeHistogram(values: Partial<Record<keyof IntervalHistogram, number>> & { count: number }): IntervalHistogram {
  return {
    ...values,
    percentile: (p: number) => {
      const byPercentile: Record<number, number> = {
        50: 0.05 * NS_PER_S,
        90: 0.5 * NS_PER_S,
        99: 2 * NS_PER_S,
      };

      return byPercentile[p];
    },
  } as unknown as IntervalHistogram;
}

describe('toEventLoopSample', () => {
  it('converts histogram nanoseconds to seconds', () => {
    const histogram = fakeHistogram({
      count: 100,
      min: 0.001 * NS_PER_S,
      max: 5 * NS_PER_S,
      mean: 0.3 * NS_PER_S,
    });

    const sample = toEventLoopSample(histogram, 0.85);

    expect(sample.utilization).toBe(0.85);
    expect(sample.delay).toEqual({ min: 0.001, max: 5, mean: 0.3, p50: 0.05, p90: 0.5, p99: 2 });
  });

  it('reports zeros for an empty histogram instead of the Infinity/0 sentinels Node returns', () => {
    // A freshly reset histogram returns min = Infinity and max = 0. Exporting Infinity would
    // break the series for every consumer, so an empty window must read as all zeros.
    const histogram = fakeHistogram({ count: 0, min: Infinity, max: 0, mean: NaN });

    const sample = toEventLoopSample(histogram, 0);

    expect(sample.delay).toEqual({ min: 0, max: 0, mean: 0, p50: 0, p90: 0, p99: 0 });
    expect(Object.values(sample.delay).every(Number.isFinite)).toBe(true);
  });

  it('passes utilization through unchanged as a 0..1 ratio', () => {
    const histogram = fakeHistogram({ count: 1, min: 0, max: 0, mean: 0 });

    expect(toEventLoopSample(histogram, 0).utilization).toBe(0);
    expect(toEventLoopSample(histogram, 1).utilization).toBe(1);
  });
});
