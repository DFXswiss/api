import { Util } from 'src/shared/util';
import { Price } from '../../exchange/dto/price.dto';
import { PriceRequest, PriceResult, PricingPathAlias, PriceStepResult } from '../services/pricing.service';
import { PriceStep } from './price-step';

export class PricePath {
  constructor(public readonly alias: PricingPathAlias, private readonly steps: PriceStep[]) {
    // validate steps configuration here
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

  private calculatePrice(path: PriceStepResult[]): PriceResult {
    const price = new Price();

    const firstStep = path[0];
    const lastStep = path[path.length - 1];

    price.source = firstStep.price.source;
    price.target = lastStep.price.target;
    price.price = Util.round(lastStep.price.price / firstStep.price.price, 8);

    return { path, price };
  }
}
