export class Price {
  source: string;
  target: string;
  price: number;

  static create(source: string, target: string, _price: number): Price {
    const price = new Price();

    price.source = source;
    price.target = target;
    price.price = _price;

    return price;
  }
}
