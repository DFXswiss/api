import { StepMisconfiguredException } from '../exceptions/step-misconfigured.exception';
import { PriceStep } from '../utils/price-step';

export class PriceStepInitSpecification {
  public static isSatisfiedBy(step: PriceStep): boolean {
    const { _options } = step;

    if (!_options.from || typeof _options.from !== 'string') {
      throw new StepMisconfiguredException(`Wrong 'from' option: ${_options.from}`);
    }

    if (!_options.to || typeof _options.to !== 'string') {
      throw new StepMisconfiguredException(`Wrong 'to' option: ${_options.to}`);
    }

    if (_options.fixedPrice === undefined && _options.providers.primary.length === 0) {
      throw new StepMisconfiguredException('No primary price providers specified');
    }

    if (_options.fixedPrice !== undefined && typeof _options.fixedPrice !== 'number') {
      throw new StepMisconfiguredException(
        `Fixed price must be a number, instead type of '${typeof _options.fixedPrice}' was provided`,
      );
    }

    if (
      _options.fixedPrice !== undefined &&
      (_options.providers.primary.length > 0 || _options.providers.reference.length > 0)
    ) {
      console.warn(`Ignoring providers for PriceStep, step configured as fixed price`);
    }

    return true;
  }
}
