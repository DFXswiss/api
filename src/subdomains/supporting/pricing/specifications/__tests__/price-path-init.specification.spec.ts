import { PathMisconfiguredException } from '../../exceptions/path-misconfigured.exception';
import { PriceStep } from '../../utils/price-step';
import { createCustomPricePath } from '../../utils/__mocks__/price-path.mock';
import { createCustomPriceStep, createDefaultPriceStep } from '../../utils/__mocks__/price-step.mock';
import { PricePathInitSpecification } from '../price-path-init.specification';

describe('PricePathInitSpecification', () => {
  describe('#isSatisfiedBy(...)', () => {
    it('refuse to create Path with no alias', () => {
      const path = createCustomPricePath({ alias: null });
      const testCall = () => PricePathInitSpecification.isSatisfiedBy(path);

      expect(testCall).toThrow(PathMisconfiguredException);
      expect(testCall).toThrowError('Alias must be a truthy value.');
    });

    it('refuse to create Path where steps are non-array value', () => {
      const path = createCustomPricePath({ steps: 4 as unknown as Array<PriceStep> });
      const testCall = () => PricePathInitSpecification.isSatisfiedBy(path);

      expect(testCall).toThrow(PathMisconfiguredException);
      expect(testCall).toThrowError('Must contain at least one PriceStep.');
    });

    it('refuse to create Path with no steps', () => {
      const path = createCustomPricePath({ steps: [] });
      const testCall = () => PricePathInitSpecification.isSatisfiedBy(path);

      expect(testCall).toThrow(PathMisconfiguredException);
      expect(testCall).toThrowError('Must contain at least one PriceStep.');
    });

    it('refuse to create Path where steps have non-matching currencies', () => {
      const path = createCustomPricePath({
        steps: [createCustomPriceStep({ to: 'BTC' }), createCustomPriceStep({ from: 'ETH' })],
      });
      const testCall = () => PricePathInitSpecification.isSatisfiedBy(path);

      expect(testCall).toThrow(PathMisconfiguredException);
      expect(testCall).toThrowError('To -> From currencies mismatch between steps.');
    });

    it('refuse to create Path with partially matching currencies', () => {
      const path = createCustomPricePath({
        steps: [
          createCustomPriceStep({ to: 'BTC' }),
          createCustomPriceStep({ from: 'BTC', to: 'ETH' }),
          createCustomPriceStep({ from: 'DFI' }),
        ],
      });
      const testCall = () => PricePathInitSpecification.isSatisfiedBy(path);

      expect(testCall).toThrow(PathMisconfiguredException);
      expect(testCall).toThrowError('To -> From currencies mismatch between steps.');
    });

    it('bypass currencies match check if there is only one step', () => {
      const path = createCustomPricePath({ steps: [createDefaultPriceStep()] });
      const testCall = () => PricePathInitSpecification.isSatisfiedBy(path);

      expect(testCall).not.toThrow(PathMisconfiguredException);
    });
  });
});
