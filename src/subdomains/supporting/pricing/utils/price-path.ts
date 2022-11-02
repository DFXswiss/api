import { cloneDeep } from 'lodash';
import { Price } from '../../../../integration/exchange/dto/price.dto';
import { PriceRequest, PriceResult, PriceStepResult } from '../interfaces';
import { PricingPathAlias } from '../services/pricing.service';
import { PricePathInitSpecification } from '../specifications/price-path-init.specification';
import { PriceStep } from './price-step';

export class PricePath {
  constructor(public readonly alias: PricingPathAlias, private readonly steps: PriceStep[]) {
    PricePathInitSpecification.isSatisfiedBy(this);
  }

  async execute(request: PriceRequest): Promise<PriceResult> {
    const results: PriceStepResult[] = [];

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];

      if (this.steps.length === 1) {
        results.push(await step.execute({ from: request.from, to: request.to }));
        break;
      }

      if (i === 0) {
        results.push(await step.execute({ from: request.from }));
        continue;
      }

      if (i === this.steps.length - 1) {
        results.push(await step.execute({ to: request.to }));
        continue;
      }

      results.push(await step.execute());
    }

    return this.calculatePrice(request, results);
  }

  //*** HELPER METHODS ***//

  private calculatePrice(request: PriceRequest, path: PriceStepResult[]): PriceResult {
    let result = 1;

    path.forEach((step) => {
      result = result * step.price.price;
    });

    return this.createPriceResult(request, path, result);
  }

  private createPriceResult(request: PriceRequest, path: PriceStepResult[], targetPrice: number): PriceResult {
    const price = Price.create(request.from, request.to, targetPrice);

    return { price, path };
  }

  //*** GETTERS ***//

  get _steps(): PriceStep[] {
    return cloneDeep(this.steps);
  }
}
