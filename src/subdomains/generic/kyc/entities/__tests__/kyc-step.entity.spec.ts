import { KycStep } from '../kyc-step.entity';
import { KycStepName } from '../../enums/kyc-step-name.enum';
import { ReviewStatus } from '../../enums/review-status.enum';

describe('KycStep.update', () => {
  const buildStep = (overrides: Partial<KycStep> = {}): KycStep =>
    Object.assign(new KycStep(), {
      id: 1,
      name: KycStepName.FINANCIAL_DATA,
      status: ReviewStatus.IN_PROGRESS,
      sequenceNumber: 5,
      ...overrides,
    });

  it('leaves status and sequenceNumber unchanged when they are omitted, and omits both from the returned partial', () => {
    const step = buildStep();

    const [, update] = step.update(undefined, [{ key: 'income', value: 'salary' }]);

    expect(step.status).toBe(ReviewStatus.IN_PROGRESS);
    expect(step.sequenceNumber).toBe(5);
    expect(update).not.toHaveProperty('status');
    expect(update).not.toHaveProperty('sequenceNumber');
  });

  it('applies an explicit status change and includes it in the returned partial', () => {
    const step = buildStep();

    const [, update] = step.update(ReviewStatus.INTERNAL_REVIEW, [{ key: 'income', value: 'salary' }]);

    expect(step.status).toBe(ReviewStatus.INTERNAL_REVIEW);
    expect(update.status).toBe(ReviewStatus.INTERNAL_REVIEW);
  });
});
