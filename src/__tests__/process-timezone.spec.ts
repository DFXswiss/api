import { DfxLogger } from 'src/shared/services/dfx-logger';
import { checkProcessTimezone } from '../process-timezone';

/** London-like: UTC in winter, BST (UTC+1 → offset -60) in summer. */
function londonLikeOffset(date: Date): number {
  // Anchors use month 0 (Jan) and 6 (Jul); treat Jan–Mar as winter.
  return date.getUTCMonth() < 6 ? 0 : -60;
}

describe('checkProcessTimezone', () => {
  let warnSpy: jest.SpyInstance;
  let infoSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation();
    infoSpy = jest.spyOn(DfxLogger.prototype, 'info').mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    infoSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('logs OK when January and July offsets are both UTC (0)', () => {
    checkProcessTimezone({
      getTimezoneOffset: () => 0,
      getTimeZoneName: () => 'UTC',
    });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0][0]).toContain('UTC');
    expect(infoSpy.mock.calls[0][0]).toMatch(/january=0.*july=0|july=0.*january=0/s);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('accepts a permanent zero-offset zone (Atlantic/Reykjavik) and logs OK', () => {
    checkProcessTimezone({
      getTimezoneOffset: () => 0,
      getTimeZoneName: () => 'Atlantic/Reykjavik',
    });

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0][0]).toContain('Atlantic/Reykjavik');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns (does not throw) for a DST zone that is UTC-offset only in winter (e.g. Europe/London)', () => {
    expect(() =>
      checkProcessTimezone({
        getTimezoneOffset: londonLikeOffset,
        getTimeZoneName: () => 'Europe/London',
      }),
    ).not.toThrow();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('Europe/London');
    expect(warnSpy.mock.calls[0][0]).toMatch(/january=0.*july=-60|july=-60.*january=0/s);
    expect(warnSpy.mock.calls[0][0]).toMatch(/must be UTC/i);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('warns (does not throw) when either seasonal offset is non-zero and names the zone', () => {
    checkProcessTimezone({
      getTimezoneOffset: () => -120,
      getTimeZoneName: () => 'Europe/Zurich',
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('Europe/Zurich');
    expect(warnSpy.mock.calls[0][0]).toMatch(/must be UTC/i);

    warnSpy.mockClear();

    checkProcessTimezone({
      getTimezoneOffset: () => -60,
      getTimeZoneName: () => 'Europe/Berlin',
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/Europe\/Berlin.*must be UTC|must be UTC.*Europe\/Berlin/s);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('samples January and July anchors via Date#getTimezoneOffset when not overridden', () => {
    const seenMonths: number[] = [];
    const spy = jest.spyOn(Date.prototype, 'getTimezoneOffset').mockImplementation(function (this: Date) {
      seenMonths.push(this.getUTCMonth());
      return 0;
    });

    checkProcessTimezone({ getTimeZoneName: () => 'UTC' });

    expect(spy).toHaveBeenCalled();
    expect(seenMonths).toEqual([0, 6]);
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns via the production default path when Date#getTimezoneOffset is seasonal (London-like)', () => {
    jest.spyOn(Date.prototype, 'getTimezoneOffset').mockImplementation(function (this: Date) {
      return this.getUTCMonth() < 6 ? 0 : -60;
    });

    checkProcessTimezone({
      getTimeZoneName: () => 'Europe/London',
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(
      /Europe\/London.*january=0.*july=-60|january=0.*july=-60.*Europe\/London/s,
    );
  });

  it('uses the default Intl zone name and default logger when neither is injected', () => {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown';

    checkProcessTimezone({
      getTimezoneOffset: () => -60,
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(new RegExp(resolved.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('falls back to "unknown" in the message when the zone name is missing', () => {
    checkProcessTimezone({
      getTimezoneOffset: () => -60,
      getTimeZoneName: () => undefined as unknown as string,
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/timezone "unknown"/);
  });

  it('accepts a no-arg call when the process offset is UTC year-round and logs OK', () => {
    jest.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0);

    expect(() => checkProcessTimezone()).not.toThrow();
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
