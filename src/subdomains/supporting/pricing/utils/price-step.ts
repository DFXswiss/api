import { cloneDeep } from 'lodash';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { Price } from '../domain/entities/price';
import { Fiat } from '../domain/enums';
import { PriceMismatchException } from '../domain/exceptions/price-mismatch.exception';
import { PriceStepResult, PricingProvider, PricingProviderName } from '../domain/interfaces';
import { PriceStepInitSpecification } from '../domain/specifications/price-step-init.specification';
import { PricingUtil } from './pricing.util';

export interface PriceStepOptions {
  from?: string | 'input';
  to?: string | 'output';
  primary?: PriceStepProviderOptions;
  reference?: PriceStepProviderOptions;
  fixedPrice?: number;
  factor?: number;
}

export interface PriceStepProviderOptions {
  providers?: PricingProvider[];
  fallback?: string;
  overwrite?: string;
}

export type PriceStepType = 'primary' | 'reference';

export class PriceStep {
  private readonly logger = new DfxLogger(PriceStep);

  private readonly options: PriceStepOptions = {};

  constructor(options: PriceStepOptions) {
    this.options = {
      from: options.from || 'input',
      to: options.to || 'output',
      primary: this.initProviderOptions(options.primary),
      reference: this.initProviderOptions(options.reference),
      fixedPrice: options.fixedPrice,
      factor: options.factor,
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

    // apply factor
    if (this.options.factor) price.price = Util.roundByPrecision(price.price * this.options.factor, 5);

    return { price, provider: vendor, timestamp: new Date() };
  }

  //*** HELPER METHODS ***//

  private initProviderOptions(options?: PriceStepProviderOptions): PriceStepProviderOptions {
    return {
      providers: options?.providers ?? [],
      fallback: options?.fallback,
      overwrite: options?.overwrite,
    };
  }

  private getFixedPrice(fromCurrency: string, toCurrency: string): [Price, PricingProviderName] {
    const price = Price.create(fromCurrency, toCurrency, this.options.fixedPrice);

    return [price, 'FixedPrice'];
  }

  private async getMatchingPrice(
    fromCurrency: string,
    toCurrency: string,
    _matchThreshold?: number,
  ): Promise<[Price, PricingProviderName]> {
    const matchThreshold = _matchThreshold ?? this.defineMatchThreshold(fromCurrency, toCurrency);
    const [primaryPrice, primaryProvider] = await this.getPrice(
      'primary',
      fromCurrency,
      toCurrency,
      this.options.primary,
    );

    try {
      const [refPrice, refSource] = await this.getPrice('reference', fromCurrency, toCurrency, this.options.reference);

      const { price: _mainPrice } = primaryPrice;
      const { price: _refPrice } = refPrice;

      if (Math.abs(_refPrice - _mainPrice) / _mainPrice > matchThreshold) {
        throw new PriceMismatchException(
          `${fromCurrency} to ${toCurrency} price mismatch (${primaryProvider}: ${_mainPrice}, ${refSource}: ${_refPrice})`,
        );
      }
    } catch (e) {
      if (e instanceof PriceMismatchException) throw e;

      this.logger.warn(
        `Proceeding without reference check (${fromCurrency} => ${toCurrency}) at ${this.options.reference.providers.map(
          (p) => p.name,
        )}`,
      );
    }

    return [primaryPrice, primaryProvider];
  }

  private defineMatchThreshold(fromCurrency: string, toCurrency: string): number {
    if (
      PricingUtil.isUsdStableCoin(fromCurrency) ||
      PricingUtil.isUsdStableCoin(toCurrency) ||
      fromCurrency === Fiat.USD ||
      toCurrency === Fiat.USD
    ) {
      return 0.005;
    }

    return 0.04;
  }

  private async getPrice(
    type: PriceStepType,
    fromCurrency: string,
    toCurrency: string,
    options: PriceStepProviderOptions,
  ): Promise<[Price, PricingProviderName]> {
    let [price, providerName] = await this.tryProviders(
      fromCurrency,
      options.overwrite ? options.overwrite : toCurrency,
      options.providers,
    );

    if (!price && options.fallback) {
      [price, providerName] = await this.tryProviders(fromCurrency, options.fallback, options.providers);
    }

    if (!price) {
      throw new Error(this.createPriceErrorMessage(type, fromCurrency, toCurrency, options));
    }

    return [price, providerName];
  }

  private async tryProviders(
    fromCurrency: string,
    toCurrency: string,
    providers: PricingProvider[] = [],
  ): Promise<[Price, PricingProviderName]> {
    for (const provider of providers) {
      try {
        return [await provider.getPrice(fromCurrency, toCurrency), provider.name];
      } catch {
        continue;
      }
    }

    return [null, null];
  }

  private createPriceErrorMessage(
    type: PriceStepType,
    fromCurrency: string,
    toCurrency: string,
    options: PriceStepProviderOptions,
  ): string {
    const mainMessage = `Could not find ${type} price (${fromCurrency} => ${toCurrency}) at ${options.providers.map(
      (p) => p.name,
    )}`;

    const fallbackMessage = options.fallback ? `Fallback to currency: ${options.fallback}` : '';

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
