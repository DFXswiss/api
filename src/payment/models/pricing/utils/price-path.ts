import { cloneDeep } from 'lodash';
import { Price } from '../../exchange/dto/price.dto';
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

    return this.calculatePrice(results);
  }

  //*** HELPER METHODS ***//

  private calculatePrice(path: PriceStepResult[]): PriceResult {
    let result = 1;

    path.forEach((step) => {
      result = result * step.price.price;
    });

    return this.createPriceResult(path, result);
  }

  private createPriceResult(path: PriceStepResult[], targetPrice: number): PriceResult {
    const firstStep = path[0];
    const lastStep = path[path.length - 1];

    const price = this.createPrice(firstStep.price.source, lastStep.price.target, targetPrice);

    return { price, path };
  }

  private createPrice(source: string, target: string, targetPrice: number): Price {
    const price = new Price();

    price.source = source;
    price.target = target;
    price.price = targetPrice;

    return price;
  }

  //*** GETTERS ***//

  get _steps(): PriceStep[] {
    return cloneDeep(this.steps);
  }
}
