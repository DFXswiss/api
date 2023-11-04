import { PricingPathAlias } from '../../services/pricing.service';
import { PricePath } from '../price-path';
import { PriceStep } from '../price-step';
import { createDefaultPriceStep } from './price-step.mock';

export function createDefaultPricePath(): PricePath {
  return createCustomPricePath({});
}

export function createCustomPricePath(customValues: { alias?: PricingPathAlias; steps?: PriceStep[] }): PricePath {
  const { alias, steps } = customValues;

  const keys = Object.keys(customValues);

  return {
    alias: keys.includes('alias') ? alias : PricingPathAlias.ALT_COIN_TO_ALT_COIN,
    _steps: keys.includes('steps') ? steps : [createDefaultPriceStep()],
  } as unknown as PricePath;
}
