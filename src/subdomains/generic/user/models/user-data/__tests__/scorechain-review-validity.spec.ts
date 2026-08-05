import { Config, ConfigService } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { UserData } from '../user-data.entity';

// The validity window is what keeps a compliance release from turning into a permanent blind spot for
// an account, so it is pinned here rather than only through the AML gate specs.
describe('UserData.hasValidScorechainReview', () => {
  beforeAll(() => {
    // Config is an uninitialized `export let` until a ConfigService is constructed.
    new ConfigService();
  });

  function userDataWith(scorechainCheckDate?: Date): UserData {
    return Object.assign(new UserData(), { scorechainCheckDate });
  }

  it('is false without a review', () => {
    expect(userDataWith(undefined).hasValidScorechainReview).toBe(false);
    expect(userDataWith(null).hasValidScorechainReview).toBe(false);
  });

  it('is true for a review inside the validity window', () => {
    expect(userDataWith(new Date()).hasValidScorechainReview).toBe(true);
    expect(userDataWith(Util.daysBefore(Config.amlScorechainReviewValidity - 1)).hasValidScorechainReview).toBe(true);
  });

  // An expired review must screen again — otherwise the release silently becomes permanent.
  it('is false once the review is older than the validity window', () => {
    expect(userDataWith(Util.daysBefore(Config.amlScorechainReviewValidity + 1)).hasValidScorechainReview).toBe(false);
  });

  // A review dated in the future must never extend the exemption: `daysDiff` goes negative there, so
  // without a lower bound the screening would stay suppressed far beyond the configured window.
  it('is false for a review dated in the future', () => {
    expect(userDataWith(Util.daysAfter(1)).hasValidScorechainReview).toBe(false);
    expect(userDataWith(Util.daysAfter(365)).hasValidScorechainReview).toBe(false);
  });

  // The exact boundary decides whether the promised window is 180 or 179 days. Time is frozen so that
  // `Date.now()` cannot advance between building the date and reading the getter — a few microseconds
  // would already push `daysDiff` past the limit and make this test flaky. The limit itself is computed
  // in milliseconds rather than through `Util.daysBefore`, which is calendar-based and would drift by an
  // hour across a DST change.
  it('is still valid at exactly the configured window and expires one millisecond later', () => {
    const now = new Date('2026-08-04T12:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);

    try {
      const exactlyAtLimit = new Date(now.getTime() - Config.amlScorechainReviewValidity * 24 * 60 * 60 * 1000);

      expect(userDataWith(exactlyAtLimit).hasValidScorechainReview).toBe(true);
      expect(userDataWith(new Date(exactlyAtLimit.getTime() - 1)).hasValidScorechainReview).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  // Pins that the getter reads the configured window instead of a hard-coded 180: with a literal in the
  // getter this test would fail, while asserting `Config.… === 180` alone would not.
  it('uses the configured window rather than a hard-coded period', () => {
    const configured = Config.amlScorechainReviewValidity;

    try {
      Config.amlScorechainReviewValidity = 10;

      expect(userDataWith(Util.daysBefore(9)).hasValidScorechainReview).toBe(true);
      expect(userDataWith(Util.daysBefore(11)).hasValidScorechainReview).toBe(false);
    } finally {
      Config.amlScorechainReviewValidity = configured;
    }
  });
});
