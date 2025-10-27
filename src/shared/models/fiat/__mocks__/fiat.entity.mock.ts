import { Fiat } from '../fiat.entity';

const defaultFiat: Partial<Fiat> = {
  id: 1,
  name: 'EUR',
  refundEnabled: true,
};

export function createDefaultFiat(): Fiat {
  return createCustomFiat({});
}

export function createCustomFiat(customValues: Partial<Fiat>): Fiat {
  return Object.assign(new Fiat(), { ...defaultFiat, ...customValues });
}
