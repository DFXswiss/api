import { KycStepName } from '../../enums/kyc-step-name.enum';
import { ReviewStatus } from '../../enums/review-status.enum';
import { KycStep } from '../kyc-step.entity';

describe('KycStep', () => {
  describe('update', () => {
    it('does not clear status or sequenceNumber when they are omitted (undefined)', () => {
      const step = Object.assign(new KycStep(), {
        id: 1,
        name: KycStepName.FINANCIAL_DATA,
        status: ReviewStatus.IN_PROGRESS,
        sequenceNumber: 7,
      });

      const [, update] = step.update(undefined, [{ key: 'tnc', value: 'accept' }]);

      expect(step.status).toBe(ReviewStatus.IN_PROGRESS);
      expect(step.sequenceNumber).toBe(7);
      expect(step.getResult()).toEqual([{ key: 'tnc', value: 'accept' }]);
      expect(update).not.toHaveProperty('status');
      expect(update).not.toHaveProperty('sequenceNumber');
      expect(update).toHaveProperty('result');
    });

    it('still applies an explicit status change', () => {
      const step = Object.assign(new KycStep(), {
        id: 1,
        name: KycStepName.FINANCIAL_DATA,
        status: ReviewStatus.IN_PROGRESS,
        sequenceNumber: 2,
      });

      step.update(ReviewStatus.OUTDATED, undefined, undefined, 3);

      expect(step.status).toBe(ReviewStatus.OUTDATED);
      expect(step.sequenceNumber).toBe(3);
    });
  });
});
