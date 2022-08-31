import { Price } from '../../exchange/dto/price.dto';
import { PriceMismatchException } from '../../exchange/exceptions/price-mismatch.exception';
import { PriceStepResult, PriceProvider, PriceProviderName } from '../interfaces';

export class PriceStep {
  constructor(
    private options: {
      from?: string | 'input';
      to?: string | 'output';
      referenceTo?: string;
      providers?: { primary: PriceProvider[]; reference: PriceProvider[] };
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
    const [primaryPrice, primaryProvider] = await this.getPrimaryPrice(fromCurrency, toCurrency);

    try {
      const [refPrice, refSource] = await this.getReferencePrice(fromCurrency, toCurrency);

      const { price: _mainPrice } = primaryPrice;
      const { price: _refPrice } = refPrice;

      if (Math.abs(_refPrice - _mainPrice) / _mainPrice > matchThreshold)
        throw new PriceMismatchException(
          `${fromCurrency} to ${toCurrency} price mismatch (${primaryProvider}: ${_mainPrice}, ${refSource}: ${_refPrice})`,
        );
    } catch (e) {
      if (e instanceof PriceMismatchException) throw e;

      console.warn(
        `Proceeding without reference check at: ${this.options.providers.reference.map(
          (p) => p.name + ' ',
        )}. From ${fromCurrency} to ${toCurrency}`,
      );
    }

    return [primaryPrice, primaryProvider];
  }

  private async getPrimaryPrice(fromCurrency: string, toCurrency: string): Promise<[Price, PriceProviderName]> {
    const primaryProviders = this.options.providers.primary;

    const [price, providerName] = await this.tryProviders(fromCurrency, toCurrency, primaryProviders);

    if (!price) {
      throw new Error(
        `Could not find primary price at: ${primaryProviders.map(
          (p) => p.name + ' ',
        )}. From ${fromCurrency} to ${toCurrency}`,
      );
    }

    return [price, providerName];
  }

  private async getReferencePrice(fromCurrency: string, toCurrency: string): Promise<[Price, PriceProviderName]> {
    const referenceProviders = this.options.providers.reference;

    const [price, providerName] = this.options.referenceTo
      ? await this.tryProviders(fromCurrency, this.options.referenceTo, referenceProviders)
      : await this.tryProviders(fromCurrency, toCurrency, referenceProviders);

    if (!price) {
      throw new Error(
        `Could not find reference price at: ${referenceProviders.map(
          (p) => p.name + '; ',
        )}. From ${fromCurrency} to ${toCurrency}`,
      );
    }

    return [price, providerName];
  }

  private async tryProviders(
    fromCurrency: string,
    toCurrency: string,
    providers: PriceProvider[] = [],
  ): Promise<[Price, PriceProviderName]> {
    for (const provider of providers) {
      try {
        return [await provider.getPrice(fromCurrency, toCurrency), provider.name];
      } catch {
        return null;
      }
    }
  }
}
