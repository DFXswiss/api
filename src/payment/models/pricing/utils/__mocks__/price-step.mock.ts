import { PriceStep, PriceStepOptions } from '../price-step';

export function createDefaultPriceStep(): PriceStep {
  return createCustomPriceStep({});
}

export function createCustomPriceStep(customOptions: Partial<PriceStepOptions>): PriceStep {
  const { from, to, overwriteReferenceTo: referenceTo, providers, fixedPrice } = customOptions;

  const keys = Object.keys(customOptions);

  return {
    _options: {
      from: keys.includes('from') ? from : 'DFI',
      to: keys.includes('to') ? to : 'BTC',
      referenceTo: keys.includes('referenceTo') ? referenceTo : 'BTC',
      providers: keys.includes('providers')
        ? providers
        : {
            primary: [{}],
            reference: [{}],
          },
      fixedPrice: keys.includes('fixedPrice') ? fixedPrice : null,
    },
    _from: keys.includes('from') ? from : 'DFI',
    _to: keys.includes('to') ? to : 'DFI',
  } as unknown as PriceStep;
}
