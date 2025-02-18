import { ApiProperty } from '@nestjs/swagger';
import { AmountType, Util } from 'src/shared/utils/util';

export class Price {
  source: string;
  target: string;
  price: number;
  isValid: boolean;
  timestamp: Date;
  steps: PriceStep[];

  invert(): Price {
    const price = Price.create(this.target, this.source, 1 / this.price, this.isValid, this.timestamp);

    if (this.steps) price.addPriceSteps(this.steps.map((s) => s.invert()).reverse());

    return price;
  }

  convert(fromAmount: number, decimals?: number): number {
    if (!this.price) {
      throw new Error('Cannot calculate target amount, price value is 0');
    }

    const targetAmount = fromAmount / this.price;
    return decimals != null ? Util.round(targetAmount, decimals) : targetAmount;
  }

  addPriceSteps(steps: PriceStep[]) {
    this.steps = [...this.steps, ...steps];
  }

  static create(
    source: string,
    target: string,
    _price: number,
    _isValid = true,
    _timestamp = new Date(),
    step?: PriceStep,
  ): Price {
    const price = new Price();

    price.source = source;
    price.target = target;
    price.price = _price;
    price.isValid = _isValid;
    price.timestamp = _timestamp;
    price.steps = step ? [step] : [];

    return price;
  }

  static join(...prices: Price[]): Price {
    const price = Price.create(
      prices[0].source,
      prices[prices.length - 1].target,
      prices.reduce((prev, curr) => prev * curr.price, 1),
      prices.reduce((prev, curr) => prev && curr.isValid, true),
      new Date(Math.min(...prices.map((p) => p.timestamp.getTime()))),
    );

    const priceSteps = prices.map((p) => p.steps).flat();
    const filteredPriceSteps = priceSteps.filter(
      (p1) => !priceSteps.some((p2) => p1 && p2 && p1.source === p2.source && p1.to === p2.from && p1.from === p2.to),
    );

    price.addPriceSteps(filteredPriceSteps);

    return price;
  }
}

export class PriceStep {
  @ApiProperty()
  source: string;

  @ApiProperty()
  from: string;

  @ApiProperty()
  to: string;

  @ApiProperty()
  price: number;

  @ApiProperty()
  timestamp: Date;

  invert(): PriceStep {
    return PriceStep.create(this.source, this.to, this.from, 1 / this.price, this.timestamp);
  }

  static create(source: string, from: string, to: string, _price: number, _timestamp = new Date()): PriceStep {
    const priceStep = new PriceStep();

    priceStep.source = source;
    priceStep.from = from;
    priceStep.to = to;
    priceStep.price = Util.roundReadable(_price, AmountType.ASSET);
    priceStep.timestamp = _timestamp;

    return priceStep;
  }
}
