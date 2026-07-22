import { KycStepName } from '../kyc-step-name.enum';
import { contextRequiredSteps, KycContext } from '../kyc.enum';

describe('contextRequiredSteps', () => {
  it('returns the full required-step set for the RealUnit buy context', () => {
    const steps = contextRequiredSteps(KycContext.REALUNIT_BUY);

    expect(steps).toEqual(
      new Set([
        KycStepName.CONTACT_DATA,
        KycStepName.PERSONAL_DATA,
        KycStepName.NATIONALITY_DATA,
        KycStepName.RECOMMENDATION,
        KycStepName.RESIDENCE_PERMIT,
        KycStepName.IDENT,
      ]),
    );
  });

  it('requires no extra steps for the RealUnit sell context', () => {
    expect(contextRequiredSteps(KycContext.REALUNIT_SELL)).toBeUndefined();
  });

  it('requires no extra steps for the RealUnit transfer context', () => {
    expect(contextRequiredSteps(KycContext.REALUNIT_TRANSFER)).toBeUndefined();
  });
});
