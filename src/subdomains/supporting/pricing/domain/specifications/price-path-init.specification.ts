import { PathMisconfiguredException } from '../exceptions/path-misconfigured.exception';
import { PricePath } from '../../utils/price-path';
import { PriceStep } from '../../utils/price-step';
import { DfxLogger } from 'src/shared/services/dfx-logger';

export class PricePathInitSpecification {
  private static readonly logger = new DfxLogger(PricePathInitSpecification);

  public static isSatisfiedBy(path: PricePath): boolean {
    const { alias, _steps } = path;

    const firstStep = _steps[0];
    const lastStep = _steps[_steps.length - 1];

    if (!alias) throw new PathMisconfiguredException('Alias must be a truthy value.');

    if (!Array.isArray(_steps) || _steps.length === 0) {
      throw new PathMisconfiguredException('Must contain at least one PriceStep.');
    }

    if (!this.isCurrenciesMatch(_steps)) {
      throw new PathMisconfiguredException('To -> From currencies mismatch between steps.');
    }

    if (firstStep._from !== 'input') {
      this.logger.warn(
        `First PriceStep 'from' configuration '${firstStep._from}' will be ignored and replaced by PriceRequest 'from' value.`,
      );
    }

    if (lastStep._to !== 'output') {
      this.logger.warn(
        `Last PriceStep 'to' configuration '${lastStep._to}' will be ignored and replaced by PriceRequest 'to' value.`,
      );
    }

    return true;
  }

  private static isCurrenciesMatch(steps: PriceStep[]): boolean {
    if (steps.length === 1) return true;

    return steps.every((step, index) => {
      return steps[index + 1] ? step._to === steps[index + 1]._from : true;
    });
  }
}
