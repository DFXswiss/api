import { PriceStep, PriceStepOptions } from '../price-step';

const defaultOptions = {
  from: 'DFI',
  to: 'BTC',
  primary: { providers: [] },
  reference: { providers: [] },
};

export function createDefaultPriceStep(): PriceStep {
  return createCustomPriceStep({});
}

export function createCustomPriceStep(customOptions: Partial<PriceStepOptions>): PriceStep {
  return {
    _from: 'from' in customOptions ? customOptions.from : defaultOptions.from,
    _to: 'to' in customOptions ? customOptions.to : defaultOptions.to,
    _options: { ...defaultOptions, ...customOptions },
  } as unknown as PriceStep;
}
