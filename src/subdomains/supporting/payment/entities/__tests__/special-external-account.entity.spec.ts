import { Config, ConfigService } from 'src/config/config';
import { Util } from 'src/shared/utils/util';
import { SpecialExternalAccount, SpecialExternalAccountType } from '../special-external-account.entity';

// The validity window keeps a compliance address exemption from becoming a permanent blind spot, so
// it is pinned here rather than only through the service / gate specs.
describe('SpecialExternalAccount.hasValidScorechainExemption', () => {
  beforeAll(() => {
    // Config is an uninitialized `export let` until a ConfigService is constructed.
    new ConfigService();
  });

  function exemptionWith(
    created?: Date,
    type = SpecialExternalAccountType.SCORECHAIN_EXEMPT_ADDRESS,
  ): SpecialExternalAccount {
    return Object.assign(new SpecialExternalAccount(), { type, created });
  }

  it('is true for a fresh exemption row', () => {
    expect(exemptionWith(new Date()).hasValidScorechainExemption).toBe(true);
  });

  // The exact boundary decides whether the promised window is honored. Time is frozen so that
  // `Date.now()` cannot advance between building the date and reading the getter.
  it('is still valid at exactly the configured window', () => {
    const now = new Date('2026-08-04T12:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);

    try {
      const exactlyAtLimit = new Date(now.getTime() - Config.amlScorechainReviewValidity * 24 * 60 * 60 * 1000);
      expect(exemptionWith(exactlyAtLimit).hasValidScorechainExemption).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  // An expired exemption must screen again — otherwise the release silently becomes permanent.
  it('is false once the exemption is older than the validity window', () => {
    expect(exemptionWith(Util.daysBefore(Config.amlScorechainReviewValidity + 1)).hasValidScorechainExemption).toBe(
      false,
    );
  });

  // A row dated in the future must never extend the exemption: `daysDiff` goes negative there, so
  // without a lower bound the screening would stay suppressed far beyond the configured window.
  it('is false for a created date in the future', () => {
    expect(exemptionWith(Util.daysAfter(1)).hasValidScorechainExemption).toBe(false);
  });

  it('is false for a non-exemption type even with a fresh created date', () => {
    expect(exemptionWith(new Date(), SpecialExternalAccountType.MULTI_ACCOUNT_IBAN).hasValidScorechainExemption).toBe(
      false,
    );
  });
});
