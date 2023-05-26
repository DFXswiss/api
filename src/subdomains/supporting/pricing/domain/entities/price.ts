import { Util } from 'src/shared/utils/util';

export class Price {
  source: string;
  target: string;
  price: number;

  invert(): Price {
    return Price.create(this.target, this.source, 1 / this.price);
  }

  convert(fromAmount: number, decimals?: number): number {
    if (!this.price) {
      throw new Error('Cannot calculate target amount, price value is 0');
    }

    const targetAmount = fromAmount / this.price;
    return decimals != null ? Util.round(targetAmount, decimals) : targetAmount;
  }

  static create(source: string, target: string, _price: number): Price {
    const price = new Price();

    price.source = source;
    price.target = target;
    price.price = _price;

    return price;
  }

  static join(...prices: Price[]): Price {
    return Price.create(
      prices[0].source,
      prices[prices.length - 1].target,
      prices.reduce((prev, curr) => prev * curr.price, 1),
    );
  }
}
