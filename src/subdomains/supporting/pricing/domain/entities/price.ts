import { ApiProperty } from '@nestjs/swagger';
import { Util } from 'src/shared/utils/util';
import { PriceSource } from './price-rule.entity';

export class Price {
  source: string;
  target: string;
  price: number;
  isValid: boolean;
  timestamp: Date;
  steps: PriceStep[];

  invert(): Price {
    return Price.create(this.target, this.source, 1 / this.price, this.isValid, this.timestamp);
  }

  convert(fromAmount: number, decimals?: number): number {
    if (!this.price) {
      throw new Error('Cannot calculate target amount, price value is 0');
    }

    const targetAmount = fromAmount / this.price;
    return decimals != null ? Util.round(targetAmount, decimals) : targetAmount;
  }

  static create(
    source: string,
    target: string,
    _price: number,
    _isValid = true,
    _timestamp = new Date(),
    _steps: PriceStep[] = [],
  ): Price {
    const price = new Price();

    price.source = source;
    price.target = target;
    price.price = _price;
    price.isValid = _isValid;
    price.timestamp = _timestamp;
    price.steps = _steps;

    return price;
  }

  addSteps(step: PriceStep[]): void {
    this.steps.push(...step);
  }

  static join(...prices: Price[]): Price {
    return Price.create(
      prices[0].source,
      prices[prices.length - 1].target,
      prices.reduce((prev, curr) => prev * curr.price, 1),
      prices.reduce((prev, curr) => prev && curr.isValid, true),
      new Date(Math.min(...prices.map((p) => p.timestamp.getTime()))),
    );
  }
}

export class PriceStep {
  @ApiProperty({ enum: PriceSource })
  source: PriceSource;

  @ApiProperty()
  from: string;

  @ApiProperty()
  to: string;

  @ApiProperty()
  price: number;

  @ApiProperty({ type: Date })
  timestamp: Date;

  static create(source: PriceSource, from: string, to: string, _price: number, _timestamp = new Date()): PriceStep {
    const priceStep = new PriceStep();

    priceStep.source = source;
    priceStep.from = from;
    priceStep.to = to;
    priceStep.price = _price;
    priceStep.timestamp = _timestamp;

    return priceStep;
  }
}
