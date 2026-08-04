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

  it('uses the configured window rather than a hard-coded period', () => {
    // Half a year, expressed in days like the sibling name-check validity.
    expect(Config.amlScorechainReviewValidity).toBe(180);
  });
});
