import { Environment } from 'src/config/config';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { assertUtcProcessTimezone } from '../process-timezone';

describe('assertUtcProcessTimezone', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(DfxLogger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('does nothing when the process offset is UTC (0)', () => {
    expect(() =>
      assertUtcProcessTimezone({
        environment: Environment.PRD,
        getTimezoneOffset: () => 0,
        getTimeZoneName: () => 'UTC',
      }),
    ).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('throws in a deployed environment when the process is not UTC and names the zone', () => {
    expect(() =>
      assertUtcProcessTimezone({
        environment: Environment.DEV,
        getTimezoneOffset: () => -120,
        getTimeZoneName: () => 'Europe/Zurich',
      }),
    ).toThrow(/Europe\/Zurich/);

    expect(() =>
      assertUtcProcessTimezone({
        environment: Environment.PRD,
        getTimezoneOffset: () => -60,
        getTimeZoneName: () => 'Europe/Berlin',
      }),
    ).toThrow(/Europe\/Berlin.*must be UTC|must be UTC.*Europe\/Berlin/s);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns but does not throw when local (LOC) and the process is not UTC', () => {
    expect(() =>
      assertUtcProcessTimezone({
        environment: Environment.LOC,
        getTimezoneOffset: () => -120,
        getTimeZoneName: () => 'Europe/Zurich',
      }),
    ).not.toThrow();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('Europe/Zurich');
    expect(warnSpy.mock.calls[0][0]).toMatch(/must be UTC/i);
  });
});
