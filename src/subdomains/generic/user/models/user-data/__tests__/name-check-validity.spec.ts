import { Config, ConfigService } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { UserData } from '../user-data.entity';

// The validity window is what keeps a completed name check from being trusted forever, so it is pinned
// here rather than only through the AML services that read it.
describe('UserData.hasValidNameCheckDate', () => {
  beforeAll(() => {
    // Config is an uninitialized `export let` until a ConfigService is constructed.
    new ConfigService();
  });

  function userDataWith(lastNameCheckDate?: Date): UserData {
    return Object.assign(new UserData(), { lastNameCheckDate });
  }

  it('is false without a check', () => {
    expect(userDataWith(undefined).hasValidNameCheckDate).toBe(false);
    expect(userDataWith(null).hasValidNameCheckDate).toBe(false);
  });

  it('is true for a check inside the validity window', () => {
    expect(userDataWith(new Date()).hasValidNameCheckDate).toBe(true);
    expect(userDataWith(Util.daysBefore(Config.amlCheckLastNameCheckValidity - 1)).hasValidNameCheckDate).toBe(true);
  });

  it('is false once the check is older than the validity window', () => {
    expect(userDataWith(Util.daysBefore(Config.amlCheckLastNameCheckValidity + 1)).hasValidNameCheckDate).toBe(false);
  });

  // A forward-dated check must not extend the window: `daysDiff` goes negative there, so without a lower
  // bound the check would count as valid far beyond the configured period.
  it('is false for a check dated in the future', () => {
    expect(userDataWith(Util.daysAfter(1)).hasValidNameCheckDate).toBe(false);
    expect(userDataWith(Util.daysAfter(365)).hasValidNameCheckDate).toBe(false);
  });

  // The exact boundary decides whether the promised window is 90 or 89 days. Time is frozen so that
  // `Date.now()` cannot advance between building the date and reading the getter — a few microseconds
  // would already push `daysDiff` past the limit and make this test flaky. The limit itself is computed
  // in milliseconds rather than through `Util.daysBefore`, which is calendar-based and would drift by an
  // hour across a DST change.
  it('is still valid at exactly the configured window and expires one millisecond later', () => {
    const now = new Date('2026-08-05T12:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);

    try {
      const exactlyAtLimit = new Date(now.getTime() - Config.amlCheckLastNameCheckValidity * 24 * 60 * 60 * 1000);

      expect(userDataWith(exactlyAtLimit).hasValidNameCheckDate).toBe(true);
      expect(userDataWith(new Date(exactlyAtLimit.getTime() - 1)).hasValidNameCheckDate).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  // Pins that the getter reads the configured window instead of a hard-coded 90.
  it('uses the configured window rather than a hard-coded period', () => {
    const configured = Config.amlCheckLastNameCheckValidity;

    try {
      Config.amlCheckLastNameCheckValidity = 10;

      expect(userDataWith(Util.daysBefore(9)).hasValidNameCheckDate).toBe(true);
      expect(userDataWith(Util.daysBefore(11)).hasValidNameCheckDate).toBe(false);
    } finally {
      Config.amlCheckLastNameCheckValidity = configured;
    }
  });
});
