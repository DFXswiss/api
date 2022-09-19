import { FiatOutput } from '../../fiat-output.entity';

const defaultFiatOutput: Partial<FiatOutput> = {};

export function createDefaultBankTx(): FiatOutput {
  return createCustomBankTx({});
}

export function createCustomBankTx(customValues: Partial<FiatOutput>): FiatOutput {
  return Object.assign(new FiatOutput(), { ...defaultFiatOutput, ...customValues });
}
