import { StepMisconfiguredException } from '../../exceptions/step-misconfigured.exception';
import { createCustomPriceStep } from '../../utils/__mocks__/price-step.mock';
import { PriceStepInitSpecification } from '../price-step-init.specification';

describe('PriceStepInitSpecification', () => {
  describe('#isSatisfiedBy(...)', () => {
    it('refuse to create Step with empty "from" option', () => {
      const step = createCustomPriceStep({ from: null });
      const testCall = () => PriceStepInitSpecification.isSatisfiedBy(step);

      expect(testCall).toThrow(StepMisconfiguredException);
      expect(testCall).toThrowError(`Wrong 'from' option: null`);
    });

    it('refuse to create Step with wrong "from" option type', () => {
      const step = createCustomPriceStep({ from: 5 as unknown as string });
      const testCall = () => PriceStepInitSpecification.isSatisfiedBy(step);

      expect(testCall).toThrow(StepMisconfiguredException);
      expect(testCall).toThrowError(`Wrong 'from' option: 5`);
    });

    it('refuse to create Step with empty "to" option', () => {
      const step = createCustomPriceStep({ to: null });
      const testCall = () => PriceStepInitSpecification.isSatisfiedBy(step);

      expect(testCall).toThrow(StepMisconfiguredException);
      expect(testCall).toThrowError(`Wrong 'to' option: null`);
    });

    it('refuse to create Step with wrong "to" option type', () => {
      const step = createCustomPriceStep({ to: 5 as unknown as string });
      const testCall = () => PriceStepInitSpecification.isSatisfiedBy(step);

      expect(testCall).toThrow(StepMisconfiguredException);
      expect(testCall).toThrowError(`Wrong 'to' option: 5`);
    });

    it('refuse to create NON fixed price Step without primary providers', () => {
      const step = createCustomPriceStep({ fixedPrice: undefined, providers: { primary: [], reference: [] } });
      const testCall = () => PriceStepInitSpecification.isSatisfiedBy(step);

      expect(testCall).toThrow(StepMisconfiguredException);
      expect(testCall).toThrowError('No primary price providers specified');
    });

    it('refuse to create fixed price Step where provided price is not a number', () => {
      const step = createCustomPriceStep({ fixedPrice: '3' as unknown as number });
      const testCall = () => PriceStepInitSpecification.isSatisfiedBy(step);

      expect(testCall).toThrow(StepMisconfiguredException);
      expect(testCall).toThrowError(`Fixed price must be a number, instead type of 'string' was provided`);
    });
  });
});
