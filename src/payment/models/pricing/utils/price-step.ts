import { Price } from '../../exchange/dto/price.dto';
import { PriceMismatchException } from '../../exchange/exceptions/price-mismatch.exception';
import { PriceStepResult, PriceProvider, PriceProviderName } from '../interfaces';

export class PriceStep {
  constructor(
    private options: {
      from?: string | 'input';
      to?: string | 'output';
      vendors?: { primary: PriceProvider; secondary: PriceProvider[] };
      fixedPrice?: number;
    },
  ) {
    // step validation
  }

  async execute(options?: { from?: string; to?: string }): Promise<PriceStepResult> {
    let _from = this.options.from;
    let _to = this.options.to;

    if (_from === 'input') {
      if (!options || !options.from) throw new Error('Should replace placeholders');

      _from = options.from;
    }

    if (_to === 'output') {
      if (!options || !options.to) throw new Error('Should replace placeholders');

      _to = options.to;
    }

    const [price, vendor] =
      this.options.fixedPrice !== undefined ? this.getFixedPrice(_from, _to) : await this.getMatchingPrice(_from, _to);

    return { price, provider: vendor, timestamp: new Date() };
  }

  private getFixedPrice(fromCurrency: string, toCurrency: string): [Price, PriceProviderName] {
    const price = new Price();

    price.source = fromCurrency;
    price.target = toCurrency;
    price.price = this.options.fixedPrice;

    return [price, 'FixedPrice'];
  }

  private async getMatchingPrice(
    fromCurrency: string,
    toCurrency: string,
    matchThreshold = 0.02,
  ): Promise<[Price, PriceProviderName]> {
    const mainPrice = await this.options.vendors.primary.getPrice(fromCurrency, toCurrency);

    try {
      const [refPrice, refSource] = await this.getReferencePrice(fromCurrency, toCurrency);

      const { price: _mainPrice } = mainPrice;
      const { price: _refPrice } = refPrice;

      if (Math.abs(_refPrice - _mainPrice) / _mainPrice > matchThreshold)
        throw new PriceMismatchException(
          `${fromCurrency} to ${toCurrency} price mismatch (kraken: ${_mainPrice}, ${refSource}: ${_refPrice})`,
        );
    } catch (e) {
      if (e instanceof PriceMismatchException) throw e;

      console.warn(
        `Proceeding without reference check from Binance, Bitstamp and Bitpanda. From ${fromCurrency} to ${toCurrency}`,
      );
    }

    return [mainPrice, this.options.vendors.primary.name];
  }

  private async getReferencePrice(fromCurrency: string, toCurrency: string): Promise<[Price, PriceProviderName]> {
    const referenceExchanges = this.options.vendors.secondary;

    for (const exchange of referenceExchanges) {
      try {
        return [await exchange.getPrice(fromCurrency, toCurrency), exchange.name];
      } catch {}
    }

    throw new Error(
      `Could not find reference price at Binance, Bitstamp and Bitpanda. From ${fromCurrency} to ${toCurrency}`,
    );
  }
}
