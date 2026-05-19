import { Util } from 'src/shared/utils/util';
import { getSampleIntervalMinutes } from '../log.repository';

describe('getSampleIntervalMinutes', () => {
  it('returns null when dailySample is true (caller picks daily bucket)', () => {
    expect(getSampleIntervalMinutes(undefined, true)).toBeNull();
    expect(getSampleIntervalMinutes(Util.daysBefore(3), true)).toBeNull();
  });

  it('returns null when no `from` is provided (no range to bucket)', () => {
    expect(getSampleIntervalMinutes(undefined, false)).toBeNull();
    expect(getSampleIntervalMinutes(undefined, undefined)).toBeNull();
  });

  it('returns null for the 24h live view (full per-minute resolution)', () => {
    expect(getSampleIntervalMinutes(Util.hoursBefore(24), false)).toBeNull();
    expect(getSampleIntervalMinutes(Util.hoursBefore(1), false)).toBeNull();
  });

  it('returns 5-minute buckets for 3-day and 1-week ranges', () => {
    expect(getSampleIntervalMinutes(Util.daysBefore(3), false)).toBe(5);
    expect(getSampleIntervalMinutes(Util.daysBefore(7), false)).toBe(5);
  });

  it('returns null beyond 1 week so callers do not silently drop data', () => {
    expect(getSampleIntervalMinutes(Util.daysBefore(14), false)).toBeNull();
    expect(getSampleIntervalMinutes(Util.daysBefore(30), false)).toBeNull();
  });
});
