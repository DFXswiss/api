import { FiatOutput } from '../fiat-output.entity';

const defaultFiatOutput: Partial<FiatOutput> = {};

export function createDefaultFiatOutput(): FiatOutput {
  return createCustomFiatOutput({});
}

export function createCustomFiatOutput(customValues: Partial<FiatOutput>): FiatOutput {
  return Object.assign(new FiatOutput(), { ...defaultFiatOutput, ...customValues });
}
