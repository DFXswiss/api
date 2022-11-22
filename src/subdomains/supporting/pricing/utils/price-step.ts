import { cloneDeep } from 'lodash';
import { Price } from '../../../../integration/exchange/dto/price.dto';
import { PriceMismatchException } from '../../../../integration/exchange/exceptions/price-mismatch.exception';
import { Fiat } from '../enums';
import { PriceStepResult, PriceProvider, PriceProviderName } from '../interfaces';
import { PriceStepInitSpecification } from '../specifications/price-step-init.specification';
import { PricingUtil } from './pricing.util';

export interface PriceStepOptions {
  from?: string | 'input';
  to?: string | 'output';
  overwriteReferenceTo?: string;
  fallbackPrimaryTo?: string;
  providers?: PriceStepProviders;
  fixedPrice?: number;
}

export interface PriceStepProviders {
  primary: PriceProvider[];
  reference: PriceProvider[];
}

export class PriceStep {
  private readonly options: PriceStepOptions = {};

  constructor(options: PriceStepOptions) {
    this.options = {
      from: options.from || 'input',
      to: options.to || 'output',
      overwriteReferenceTo: options.overwriteReferenceTo,
      fallbackPrimaryTo: options.fallbackPrimaryTo,
      providers: {
        primary: options.providers?.primary || [],
        reference: options.providers?.reference || [],
      },
      fixedPrice: options.fixedPrice,
    };

    PriceStepInitSpecification.isSatisfiedBy(this);
  }

  async execute(options?: { from?: string; to?: string }): Promise<PriceStepResult> {
    let _from = this.options.from;
    let _to = this.options.to;

    if (_from === 'input') {
      if (!options || !options.from) {
        throw new Error(`No 'from' option provided to replace 'input' placeholder in PriceStep`);
      }

      _from = options.from;
    }

    if (_to === 'output') {
      if (!options || !options.to) {
        throw new Error(`No 'to' option provided to replace 'output' placeholder in PriceStep`);
      }

      _to = options.to;
    }

    const [price, vendor] =
      this.options.fixedPrice !== undefined ? this.getFixedPrice(_from, _to) : await this.getMatchingPrice(_from, _to);

    return { price, provider: vendor, timestamp: new Date() };
  }

  //*** HELPER METHODS ***//

  private getFixedPrice(fromCurrency: string, toCurrency: string): [Price, PriceProviderName] {
    const price = Price.create(fromCurrency, toCurrency, this.options.fixedPrice);

    return [price, 'FixedPrice'];
  }

  private async getMatchingPrice(
    fromCurrency: string,
    toCurrency: string,
    _matchThreshold?: number,
  ): Promise<[Price, PriceProviderName]> {
    const matchThreshold = _matchThreshold ?? this.defineMatchThreshold(fromCurrency, toCurrency);
    const [primaryPrice, primaryProvider] = await this.getPrimaryPrice(fromCurrency, toCurrency);

    try {
      const [refPrice, refSource] = await this.getReferencePrice(fromCurrency, toCurrency);

      const { price: _mainPrice } = primaryPrice;
      const { price: _refPrice } = refPrice;

      if (Math.abs(_refPrice - _mainPrice) / _mainPrice > matchThreshold) {
        throw new PriceMismatchException(
          `${fromCurrency} to ${toCurrency} price mismatch (${primaryProvider}: ${_mainPrice}, ${refSource}: ${_refPrice})`,
        );
      }
    } catch (e) {
      if (e instanceof PriceMismatchException) throw e;

      console.warn(
        `Proceeding without reference check at: ${this.options.providers.reference.map(
          (p) => p.name,
        )}. From ${fromCurrency} to ${toCurrency}`,
      );
    }

    return [primaryPrice, primaryProvider];
  }

  private defineMatchThreshold(fromCurrency: string, toCurrency: string): number {
    if (
      PricingUtil.isUSDStablecoin(fromCurrency) ||
      PricingUtil.isUSDStablecoin(toCurrency) ||
      fromCurrency === Fiat.USD ||
      toCurrency === Fiat.USD
    ) {
      return 0.005;
    }

    return 0.02;
  }

  private async getPrimaryPrice(fromCurrency: string, toCurrency: string): Promise<[Price, PriceProviderName]> {
    const primaryProviders = this.options.providers.primary;

    let [price, providerName] = await this.tryProviders(fromCurrency, toCurrency, primaryProviders);

    if (!price && this.options.fallbackPrimaryTo) {
      [price, providerName] = await this.tryProviders(fromCurrency, this.options.fallbackPrimaryTo, primaryProviders);
    }

    if (!price) {
      throw new Error(this.createPrimaryPriceErrorMessage(primaryProviders, fromCurrency, toCurrency));
    }

    return [price, providerName];
  }

  private async getReferencePrice(fromCurrency: string, toCurrency: string): Promise<[Price, PriceProviderName]> {
    const referenceProviders = this.options.providers.reference;

    const [price, providerName] = this.options.overwriteReferenceTo
      ? await this.tryProviders(fromCurrency, this.options.overwriteReferenceTo, referenceProviders)
      : await this.tryProviders(fromCurrency, toCurrency, referenceProviders);

    if (!price) {
      throw new Error(
        `Could not find reference price at: ${referenceProviders.map(
          (p) => p.name + ';',
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
        continue;
      }
    }

    return [null, null];
  }

  private createPrimaryPriceErrorMessage(
    primaryProviders: PriceProvider[],
    fromCurrency: string,
    toCurrency: string,
  ): string {
    const mainMessage = `Could not find primary price at: ${primaryProviders.map(
      (p) => p.name + ' ',
    )}. From ${fromCurrency} to ${toCurrency}. `;

    const fallbackMessage = this.options.fallbackPrimaryTo
      ? `Fallback to currency: ${this.options.fallbackPrimaryTo}`
      : '';

    return mainMessage + fallbackMessage;
  }

  //*** GETTERS ***//

  get _options(): PriceStepOptions {
    return cloneDeep(this.options);
  }

  get _from(): string {
    return this.options.from;
  }

  get _to(): string {
    return this.options.to;
  }
}
